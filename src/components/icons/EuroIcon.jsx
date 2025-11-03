export default function EuroIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* Main C curve */}
      <path d="M20 6.5c-1.9-2.1-4.3-3-7-3-4.2 0-7.5 3.3-7.5 7.5s3.3 7.5 7.5 7.5c2.7 0 5.1-.9 7-3" />
      {/* Upper bar goes through */}
      <path d="M3 10.5h12" />
      {/* Lower bar goes through */}
      <path d="M3 13.5h11" />
    </svg>
  );
}