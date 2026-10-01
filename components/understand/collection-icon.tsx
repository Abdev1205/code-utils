import {
  FileChartColumn,
  FileText,
  GraduationCap,
  Microscope,
  ShieldCheck,
  Siren,
  Sparkles,
} from "lucide-react";

/**
 * Collections name their icon as a string so the config stays server-safe.
 * Rendered by an explicit switch rather than a lookup table: returning a
 * component value from a function makes it look newly created on every render.
 */
export function CollectionIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  switch (name) {
    case "GraduationCap":
      return <GraduationCap className={className} />;
    case "Sparkles":
      return <Sparkles className={className} />;
    case "Siren":
      return <Siren className={className} />;
    case "ShieldCheck":
      return <ShieldCheck className={className} />;
    case "Microscope":
      return <Microscope className={className} />;
    case "FileChartColumn":
      return <FileChartColumn className={className} />;
    default:
      return <FileText className={className} />;
  }
}
