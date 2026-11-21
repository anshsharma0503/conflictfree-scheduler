import { Link } from "react-router-dom";

/**
 * Two calendar blocks that sit side by side without overlapping.
 * Rendered as a link with the product name as its accessible label.
 */
function BrandMark({ to = "/" }) {
  return (
    <Link className="brand" to={to} aria-label="ConflictFree home">
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="2" y="3" width="9" height="11" rx="2" fill="#15161A" />
        <rect x="13" y="10" width="9" height="11" rx="2" fill="#0D6650" />
      </svg>
      <span aria-hidden="true">ConflictFree</span>
    </Link>
  );
}

export default BrandMark;
