import ProfileView from "@/components/ProfileView";
import { getProfile, type Profile } from "@/lib/api";

export const dynamic = "force-dynamic";

export const metadata = { title: "My profile — RFQClub" };

export default async function ProfilePage() {
  let profile: Profile;
  try {
    profile = await getProfile();
  } catch {
    return (
      <div className="pf">
        <div className="pf-top">
          <span className="pf-mark">RFQ<b>Club</b>.</span>
        </div>
        <div style={{ padding: 40, textAlign: "center", color: "#8A857A" }}>
          Profile service is unavailable right now. Start the API and refresh.
        </div>
      </div>
    );
  }
  return <ProfileView profile={profile} />;
}
