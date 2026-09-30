"""Telegram ingestion worker (python-telegram-bot, long-polling).

Listens in ALLOWED_CHAT_IDS. Any forwarded/typed text, caption or transcript is
stripped of the forward signature, parsed (regex) -> optional LLM-assist ->
deduped against live RFQs -> stored as a PENDING pending_draft, and the sender
gets the structured draft back for a quick clarify loop. NOTHING is published
here: an operator approves via /approve (or review.py). That is the human gate.

Run:  python ingest_bot.py     (needs TELEGRAM_BOT_TOKEN in api/config.env)

Operator commands (chat id in OPERATOR_CHAT_IDS):
    /pending            list PENDING drafts
    /approve <id>       write to rfq table as draft
    /publish <id>       approve AND set status=published
    /reject <id>        mark rejected
Voice STT is a later phase; a supplied transcript text is accepted as-is.
"""
from __future__ import annotations
import logging
import re

import config
import db
import llm_structurer
import rfq_parser
from draft_util import create_draft, dedupe_hit, render_draft

logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s", level=logging.INFO)
log = logging.getLogger("rfqclub.bot")

_FORWARD_SIG = re.compile(r"^\s*(?:Replied|Forwarded)?\s*(?:message)?\s*from\s*:?\s*\n?", re.I)
_BOT_COMMANDS = {"/start", "/help", "/pending", "/approve", "/publish", "/reject"}


def _clean(text: str) -> str:
    return _FORWARD_SIG.sub("", text or "").strip()


def _session():
    db.init_db()
    return db.SessionLocal()


def _reply_draft_text(draft) -> str:
    low_conf = [k for k, v in (draft.confidence or {}).items()
                if isinstance(v, (int, float)) and v < 0.6]
    head = "📥 Captured as draft #%d (awaiting concierge review)\n" % draft.id
    tail = ""
    if low_conf:
        tail = f"\n\n⚠️ Please clarify: {', '.join(low_conf)}."
    return head + render_draft(draft) + tail


async def handle_text(update, context):
    msg = update.message or update.edited_message
    if not msg:
        return
    chat_id = msg.chat.id
    if config.ALLOWED_CHAT_IDS and chat_id not in config.ALLOWED_CHAT_IDS:
        log.info("ignored message from unauthorized chat %s", chat_id)
        return

    text = _clean(msg.text or "")
    if not text or text.lower() in _BOT_COMMANDS:
        await msg.reply_text(
            "Forward or type an RFQ here (title, quantity, budget, deadline). "
            "A concierge reviews every capture before it goes live."
        )
        return

    s = _session()
    try:
        dup = dedupe_hit(s, text.splitlines()[0] if text else "")
        parsed = rfq_parser.from_freeform(text)
        enriched = llm_structurer.structure(text, parsed) or parsed
        if dup is not None:
            await msg.reply_text(
                f"Looks like “{dup.title[:60]}” is already on the board as {dup.code}. "
                "Send materially different details to capture it as a new draft."
            )
            return
        draft = create_draft(
            s, raw_text=msg.text or "", parsed=enriched,
            confidence=enriched.get("confidence", {}),
            source_chat_id=chat_id, source_msg_id=msg.message_id,
        )
        await msg.reply_text(_reply_draft_text(draft))
        # notify operators
        for op in config.OPERATOR_CHAT_IDS:
            try:
                await context.bot.send_message(op, f"New draft #{draft.id} pending review.\n"
                                                   f"/approve {draft.id}  ·  /reject {draft.id}")
            except Exception as e:  # noqa: BLE001
                log.warning("operator notify failed for %s: %s", op, e)
    finally:
        s.close()


async def handle_media(update, context):
    """Documents/photos/voice: use caption if present; transcript accepted later."""
    msg = update.message
    if not msg:
        return
    chat_id = msg.chat.id
    if config.ALLOWED_CHAT_IDS and chat_id not in config.ALLOWED_CHAT_IDS:
        return
    caption = _clean(msg.caption or "")
    if caption:
        await handle_text(update, context)
        return
    await msg.reply_text(
        "Got the attachment. Please paste the key details (title, qty, budget, "
        "deadline) as text so the concierge can structure it."
    )


def _is_operator(chat_id: int) -> bool:
    return (not config.OPERATOR_CHAT_IDS) or chat_id in config.OPERATOR_CHAT_IDS


async def cmd_pending(update, context):
    if not _is_operator(update.effective_chat.id):
        return
    s = _session()
    try:
        import models
        rows = s.query(models.PendingDraft).filter(models.PendingDraft.status == "PENDING").order_by(models.PendingDraft.id).all()
        if not rows:
            await update.message.reply_text("No PENDING drafts.")
            return
        out = [f"{len(rows)} PENDING:\n"]
        for d in rows:
            p = d.parsed or {}
            out.append(f"#{d.id} [{p.get('sector_key','?')}] {(p.get('title') or '')[:50]}")
        await update.message.reply_text("\n".join(out))
    finally:
        s.close()


async def _approve_cmd(update, context, publish: bool):
    if not _is_operator(update.effective_chat.id):
        return
    import review
    args = context.args or []
    if not args or not args[0].isdigit():
        await update.message.reply_text("Usage: /approve <draft_id>")
        return
    ns = _FakeArgs(int(args[0]), publish)
    review.cmd_approve(ns)
    import models
    s = _session()
    try:
        d = s.get(models.PendingDraft, ns.draft_id)
        await update.message.reply_text(f"Draft #{ns.draft_id} approved ({'published' if publish else 'draft'}).")
    finally:
        s.close()


class _FakeArgs:
    """review.cmd_approve reads args.draft_id and args.publish."""
    def __init__(self, draft_id: int, publish: bool):
        self.draft_id = draft_id
        self.publish = publish


async def cmd_approve(update, context):
    await _approve_cmd(update, context, publish=False)


async def cmd_publish(update, context):
    await _approve_cmd(update, context, publish=True)


async def cmd_reject(update, context):
    if not _is_operator(update.effective_chat.id):
        return
    args = context.args or []
    if not args or not args[0].isdigit():
        await update.message.reply_text("Usage: /reject <draft_id>")
        return
    import models
    s = _session()
    try:
        d = s.get(models.PendingDraft, int(args[0]))
        if not d:
            await update.message.reply_text("Not found.")
            return
        from datetime import datetime, timezone
        d.status = "REJECTED"
        d.reviewed_at = datetime.now(timezone.utc)
        s.commit()
        await update.message.reply_text(f"Draft #{d.id} rejected.")
    finally:
        s.close()


def main():
    if not config.TELEGRAM_BOT_TOKEN:
        raise SystemExit(
            "TELEGRAM_BOT_TOKEN is not set. Create a bot via @BotFather, then put\n"
            "the token (and ALLOWED_CHAT_IDS / OPERATOR_CHAT_IDS) in api/config.env."
        )
    from telegram.ext import Application, MessageHandler, CommandHandler, filters

    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
    app.add_handler(CommandHandler("pending", cmd_pending))
    app.add_handler(CommandHandler("approve", cmd_approve))
    app.add_handler(CommandHandler("publish", cmd_publish))
    app.add_handler(CommandHandler("reject", cmd_reject))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(MessageHandler(
        filters.Document.ALL | filters.PHOTO | filters.VOICE | filters.AUDIO | filters.Video,
        handle_media,
    ))
    log.info("RFQClub ingestion bot polling (allowed_chats=%s operators=%s, llm=%s)",
             config.ALLOWED_CHAT_IDS or "*", config.OPERATOR_CHAT_IDS or "*",
             config.LLM_ENABLED)
    app.run_polling(allowed_updates=["message", "edited_message"])


if __name__ == "__main__":
    main()
