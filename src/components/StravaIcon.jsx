/**
 * Strava logo (chevron) – monochrome for use on colored buttons (e.g. white on green).
 * ~18–20px height; use size prop or className for sizing.
 */
export default function StravaIcon({ className = '', size = 20, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path
        fill="currentColor"
        d="M20.516 23.927l-2.786-5.49h-4.083l6.87 13.563 6.865-13.563h-4.083zM13.953 10.974l3.781 7.464h5.563l-9.344-18.438-9.333 18.438h5.557z"
      />
    </svg>
  );
}
