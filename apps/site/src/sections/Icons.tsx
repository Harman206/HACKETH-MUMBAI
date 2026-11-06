/** The Copeybara mark: lime capybara on near-black (assets/brand/copeybara-mark.svg). */
export function BrandMark() {
  return (
    <svg viewBox="0 0 104 104" width="32" height="32" aria-hidden="true">
      <rect width="104" height="104" rx="26" fill="#141615" stroke="#3a403c" stroke-width="3" />
      <path fill="#c4fa4f" fill-rule="evenodd" transform="translate(11 17) scale(.8)" d="M10 73c2-17 10-33 19-46a7 7 0 0 1-3-6 8 8 0 0 1 15-3c6-2 13-1 20 1l27 6c4 1 6 3 6 7v17c0 7-4 10-10 11l-24 2-9 11H10Zm52-36a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    </svg>
  );
}

export function ExitIllustration() {
  return (
    <svg class="exit-art" viewBox="0 0 580 480" aria-hidden="true" focusable="false">
      <defs>
        <pattern id="paper-dots" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".7" fill="#38533d" opacity=".25" />
        </pattern>
        <pattern id="coat-dots" width="7" height="7" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="3" r=".7" fill="#dce7b7" opacity=".42" />
        </pattern>
        <path id="capy-coat" d="M98 357c-9-20-5-42 11-62 28-35 72-51 127-45l52 8c16-1 26-12 34-26l12-23c-3-12-2-24 6-28 8-4 16 4 19 14 13-3 24-1 35 4l36 17c17 8 23 20 21 38l-2 12c-1 8-7 13-16 14l-48 3c-9 0-16 6-20 14l-17 38-2 39c0 8-5 13-13 13h-31c-6 0-9-5-6-10l11-18-6-19c-26 17-66 23-114 20l-14 23c-2 3-5 4-9 4h-30c-6 0-9-6-5-11l13-18c-23-6-37-16-44-31Z" />
      </defs>
      <rect width="580" height="480" fill="#eaf0dc" />
      <rect width="580" height="480" fill="url(#paper-dots)" />
      <path d="M298 386V171c0-67 50-116 108-116s108 49 108 116v215Z" fill="#cddcaf" />
      <path class="exit-door" d="M319 386V172c0-54 38-96 87-96s87 42 87 96v214Z" fill="#f7f9ed" />
      <path d="M335 386V173c0-45 31-81 71-81s71 36 71 81v213" fill="none" stroke="#aebd94" />
      <path d="M31 386h518M53 401h473m-414 14h345" fill="none" stroke="#9daf91" />
      <circle cx="148" cy="149" r="56" fill="#d9e4bf" />
      <circle cx="148" cy="149" r="56" fill="url(#paper-dots)" />
      <path d="M64 364c-2-22-10-36-23-49m23 49c2-25 10-43 22-56m-22 56c-8-15-18-20-28-23m458 45c4-33 15-52 33-65m-33 65c-3-22-11-35-21-45m21 45c11-14 21-19 33-22" fill="none" stroke="#587157" stroke-width="2" stroke-linecap="round" />
      <g class="capybara">
        <use href="#capy-coat" fill="#294634" />
        <use href="#capy-coat" fill="url(#coat-dots)" />
        <path d="M115 321c24-36 71-55 125-48m-111 64c17-23 42-36 70-42m22 36c-5 13-14 24-26 29m120-62c2 12-4 26-14 42m69-73c9 6 16 8 26 7m24-23c8 1 15 1 22-1" fill="none" stroke="#829c74" stroke-width="2" stroke-linecap="round" />
        <path d="M338 198c-2-7-1-12 2-13 4-1 8 4 10 10" fill="none" stroke="#a5b990" stroke-width="2" stroke-linecap="round" />
        <path d="M375 223c6-5 13-4 19 1" fill="none" stroke="#ecf3dc" stroke-width="2.6" stroke-linecap="round" />
        <circle cx="387" cy="226" r="2.7" fill="#ecf3dc" />
        <path d="M432 231c5 0 9 3 9 5-1 2-6 2-10 0-2-2-1-4 1-5Z" fill="#11291b" />
      </g>
      <path class="exit-arrow" d="M448 145h56m-17-17 17 17-17 17" fill="none" stroke="#35563c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
