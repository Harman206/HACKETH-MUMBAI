/** The kit's capybara (apps/kit/src/screens/Icons.tsx), on a tile in the current text colour. */
const CAPY_PATH = 'M10 73c2-17 10-33 19-46a7 7 0 0 1-3-6 8 8 0 0 1 15-3c6-2 13-1 20 1l27 6c4 1 6 3 6 7v17c0 7-4 10-10 11l-24 2-9 11H10Zm52-36a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z';

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg class="brandmark" viewBox="0 0 104 104" width={size} height={size} aria-hidden="true">
      <rect width="104" height="104" rx="28" fill="currentColor" />
      <path fill-rule="evenodd" class="brandmark-capy" transform="translate(11 17) scale(.8)" d={CAPY_PATH} />
    </svg>
  );
}
