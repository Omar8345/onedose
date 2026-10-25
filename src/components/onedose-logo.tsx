export function OneDoseLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`logo ${className}`.trim()} aria-label="OneDose">
      <span className="logo-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span>OneDose</span>
    </div>
  );
}
