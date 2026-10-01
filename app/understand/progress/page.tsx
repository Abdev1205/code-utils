import { ProgressDashboard } from "@/components/understand/progress-dashboard";
import { indexDocs } from "@/lib/understand";
import { readPlan } from "@/lib/understand/plan";
import { discoverTracks } from "@/lib/understand/roots";

export const dynamic = "force-dynamic";
export const metadata = { title: "Progress · Understand" };

export default async function ProgressPage() {
  const [docs, tracks] = await Promise.all([indexDocs(), discoverTracks()]);

  // One block per track, so a second subject shows up here without code changes.
  const trackProgress = await Promise.all(
    tracks.map(async (track) => ({
      id: track.id,
      name: track.name,
      description: track.description,
      modules: docs
        .filter((doc) => doc.collection === track.id && doc.moduleNumber)
        .sort((a, b) =>
          (a.moduleNumber ?? "").localeCompare(b.moduleNumber ?? ""),
        ),
      plan: await readPlan(track.dir),
    })),
  );

  return (
    <ProgressDashboard
      tracks={trackProgress}
      archivedCount={docs.filter((d) => d.archived).length}
    />
  );
}
