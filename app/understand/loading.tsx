import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="mt-2 h-4 w-96" />
      <div className="mt-5 mb-4 flex gap-2">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="mb-4 flex gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-24" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card px-4 py-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="mt-2 h-3 w-4/5" />
            <Skeleton className="mt-2.5 h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
