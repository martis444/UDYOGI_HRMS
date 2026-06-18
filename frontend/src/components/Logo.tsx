import Image from "next/image";

interface LogoProps {
  variant?: "full" | "mark";
  theme?: "dark" | "light";
  className?: string;
}

export default function Logo({
  variant = "full",
  theme = "light",
  className = "",
}: LogoProps) {
  if (variant === "mark") {
    return (
      <div className={`flex items-center gap-0.5 ${className}`}>
        <span
          className={`font-bold italic text-xl leading-none tracking-tight ${
            theme === "dark" ? "text-white" : "text-[#1A1A1A]"
          }`}
        >
          U
        </span>
        <svg
          width="14"
          height="18"
          viewBox="0 0 14 18"
          fill="none"
          className="shrink-0"
        >
          <path d="M2 2L8 9L2 16" stroke="#E5202E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M7 2L13 9L7 16" stroke="#E5202E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`flex items-center ${className}`}>
      <Image
        src="/udyogi-logo.png"
        alt="Udyogi HRMS"
        width={210}
        height={63}
        priority
        unoptimized
        className="object-contain"
        style={theme === "dark" ? { filter: "drop-shadow(0 0 6px rgba(255,255,255,0.6)) drop-shadow(0 0 2px rgba(255,255,255,0.9))" } : undefined}
        onError={() => {}}
      />
    </div>
  );
}

export function LogoFallback({
  theme = "dark",
  className = "",
}: {
  theme?: "dark" | "light";
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <rect width="28" height="28" rx="6" fill="#E5202E" />
        <path d="M7 7L14 14L7 21" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13 7L20 14L13 21" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      </svg>
      <span
        className={`font-bold italic text-lg tracking-tight ${
          theme === "dark" ? "text-white" : "text-[#1A1A1A]"
        }`}
      >
        UDYOGI
      </span>
    </div>
  );
}
