/**
 * War of Agents — Inline SVG Asset Library
 * All art is pure SVG strings — zero network requests, fully cacheable.
 */

// ── Faction Crests ─────────────────────────────────���────────────────────────

export const ALLIANCE_CREST = `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="al-shield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#6AB0FF"/>
      <stop offset="50%" stop-color="#3070C0"/>
      <stop offset="100%" stop-color="#1A4080"/>
    </linearGradient>
    <linearGradient id="al-trim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFD700"/>
      <stop offset="100%" stop-color="#B8860B"/>
    </linearGradient>
    <filter id="al-glow"><feGaussianBlur stdDeviation="3" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <!-- Shield body -->
  <path d="M60 8 L108 30 L108 75 Q108 120 60 136 Q12 120 12 75 L12 30 Z" fill="url(#al-shield)" stroke="url(#al-trim)" stroke-width="4"/>
  <!-- Inner border -->
  <path d="M60 18 L98 36 L98 73 Q98 112 60 126 Q22 112 22 73 L22 36 Z" fill="none" stroke="#FFD70066" stroke-width="1.5"/>
  <!-- Lion head (stylized) -->
  <g transform="translate(60,72)" filter="url(#al-glow)">
    <!-- Mane -->
    <circle cx="0" cy="-8" r="28" fill="none" stroke="#FFD700" stroke-width="2.5" opacity="0.6"/>
    <circle cx="0" cy="-8" r="22" fill="#1A4080"/>
    <!-- Face -->
    <ellipse cx="0" cy="-6" rx="16" ry="18" fill="#2A60A0"/>
    <!-- Eyes -->
    <ellipse cx="-6" cy="-12" rx="3" ry="2.5" fill="#FFD700"/>
    <ellipse cx="6" cy="-12" rx="3" ry="2.5" fill="#FFD700"/>
    <circle cx="-6" cy="-12" r="1.2" fill="#1A1A40"/>
    <circle cx="6" cy="-12" r="1.2" fill="#1A1A40"/>
    <!-- Nose -->
    <path d="M-3 -5 L0 -2 L3 -5" fill="none" stroke="#FFD700" stroke-width="1.5" stroke-linecap="round"/>
    <!-- Mouth -->
    <path d="M-6 2 Q0 8 6 2" fill="none" stroke="#FFD700" stroke-width="1.2"/>
    <!-- Crown points -->
    <path d="M-14 -28 L-10 -20 L-6 -26 L0 -18 L6 -26 L10 -20 L14 -28" fill="none" stroke="#FFD700" stroke-width="2" stroke-linecap="round"/>
  </g>
  <!-- Sword cross -->
  <line x1="38" y1="44" x2="82" y2="44" stroke="#FFD70088" stroke-width="2"/>
  <line x1="60" y1="32" x2="60" y2="56" stroke="#FFD70088" stroke-width="2"/>
</svg>`;

export const HORDE_CREST = `<svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="ho-bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#CC3333"/>
      <stop offset="50%" stop-color="#8B1A1A"/>
      <stop offset="100%" stop-color="#4A0A0A"/>
    </linearGradient>
    <linearGradient id="ho-trim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FF6644"/>
      <stop offset="100%" stop-color="#882211"/>
    </linearGradient>
    <filter id="ho-glow"><feGaussianBlur stdDeviation="2.5" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <!-- Spiked frame -->
  <path d="M60 4 L95 14 L112 40 L108 80 Q100 125 60 138 Q20 125 12 80 L8 40 L25 14 Z" fill="url(#ho-bg)" stroke="url(#ho-trim)" stroke-width="3.5"/>
  <!-- Spikes -->
  <path d="M60 4 L63 -4 L60 4 M95 14 L102 8 L95 14 M25 14 L18 8 L25 14 M112 40 L120 38 M8 40 L0 38" stroke="#FF6644" stroke-width="2" fill="none"/>
  <!-- Inner border -->
  <path d="M60 16 L90 24 L104 46 L100 80 Q94 118 60 128 Q26 118 20 80 L16 46 L30 24 Z" fill="none" stroke="#FF664433" stroke-width="1.5"/>
  <!-- Skull -->
  <g transform="translate(60,68)" filter="url(#ho-glow)">
    <!-- Cranium -->
    <ellipse cx="0" cy="-14" rx="24" ry="22" fill="#D4C4A0" opacity="0.9"/>
    <ellipse cx="0" cy="-14" rx="22" ry="20" fill="#C0B088"/>
    <!-- Eye sockets -->
    <ellipse cx="-9" cy="-16" rx="7" ry="8" fill="#4A0A0A"/>
    <ellipse cx="9" cy="-16" rx="7" ry="8" fill="#4A0A0A"/>
    <!-- Glowing eyes -->
    <ellipse cx="-9" cy="-16" rx="4" ry="5" fill="#FF2200" opacity="0.8"/>
    <ellipse cx="9" cy="-16" rx="4" ry="5" fill="#FF2200" opacity="0.8"/>
    <ellipse cx="-9" cy="-17" rx="2" ry="2.5" fill="#FF6644" opacity="0.6"/>
    <ellipse cx="9" cy="-17" rx="2" ry="2.5" fill="#FF6644" opacity="0.6"/>
    <!-- Nose hole -->
    <path d="M-3 -4 L0 0 L3 -4" fill="#6A3A1A" stroke="none"/>
    <!-- Jaw -->
    <path d="M-18 -2 Q-16 14 0 16 Q16 14 18 -2" fill="#B0A078" stroke="#8A7A58" stroke-width="1"/>
    <!-- Teeth -->
    <line x1="-10" y1="2" x2="-10" y2="8" stroke="#D4C4A0" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="-4" y1="3" x2="-4" y2="10" stroke="#D4C4A0" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="4" y1="3" x2="4" y2="10" stroke="#D4C4A0" stroke-width="2.5" stroke-linecap="round"/>
    <line x1="10" y1="2" x2="10" y2="8" stroke="#D4C4A0" stroke-width="2.5" stroke-linecap="round"/>
    <!-- Tusks -->
    <path d="M-16 0 Q-22 -6 -20 -16" fill="none" stroke="#EEDDBB" stroke-width="3" stroke-linecap="round"/>
    <path d="M16 0 Q22 -6 20 -16" fill="none" stroke="#EEDDBB" stroke-width="3" stroke-linecap="round"/>
  </g>
  <!-- Crossed axes behind skull -->
  <g opacity="0.3">
    <line x1="28" y1="40" x2="92" y2="100" stroke="#FF6644" stroke-width="3"/>
    <line x1="92" y1="40" x2="28" y2="100" stroke="#FF6644" stroke-width="3"/>
  </g>
</svg>`;

// ── Hero Class Icons (64x64 viewBox) ────────────────────────────────────────

export const HERO_KNIGHT = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="kn-steel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#C0C8D8"/>
      <stop offset="100%" stop-color="#606878"/>
    </linearGradient>
    <linearGradient id="kn-gold" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#FFD700"/>
      <stop offset="100%" stop-color="#B8860B"/>
    </linearGradient>
  </defs>
  <!-- Helmet -->
  <path d="M16 38 L16 22 Q16 6 32 4 Q48 6 48 22 L48 38 Z" fill="url(#kn-steel)" stroke="#8890A0" stroke-width="1.5"/>
  <!-- Visor slit -->
  <rect x="20" y="26" width="24" height="5" rx="2" fill="#1A1A2A"/>
  <!-- Eye glow -->
  <ellipse cx="27" cy="28" rx="3" ry="1.5" fill="#4A8FE0" opacity="0.8"/>
  <ellipse cx="37" cy="28" rx="3" ry="1.5" fill="#4A8FE0" opacity="0.8"/>
  <!-- Nose guard -->
  <line x1="32" y1="22" x2="32" y2="33" stroke="#A0A8B8" stroke-width="2"/>
  <!-- Plume -->
  <path d="M32 4 Q38 -2 36 8 Q42 2 40 12 Q46 6 42 14" fill="none" stroke="#E24B4A" stroke-width="2.5" stroke-linecap="round"/>
  <!-- Shoulder plates -->
  <path d="M12 38 Q8 40 6 48 L20 46 Z" fill="url(#kn-steel)" stroke="#8890A0" stroke-width="1"/>
  <path d="M52 38 Q56 40 58 48 L44 46 Z" fill="url(#kn-steel)" stroke="#8890A0" stroke-width="1"/>
  <!-- Chest plate -->
  <path d="M18 38 L46 38 L44 58 Q32 62 20 58 Z" fill="url(#kn-steel)" stroke="#8890A0" stroke-width="1"/>
  <!-- Cross emblem -->
  <line x1="32" y1="42" x2="32" y2="54" stroke="url(#kn-gold)" stroke-width="2.5"/>
  <line x1="26" y1="47" x2="38" y2="47" stroke="url(#kn-gold)" stroke-width="2.5"/>
</svg>`;

export const HERO_RANGER = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rn-hood" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2A5A2A"/>
      <stop offset="100%" stop-color="#1A3A1A"/>
    </linearGradient>
  </defs>
  <!-- Hood -->
  <path d="M14 36 L14 20 Q14 4 32 2 Q50 4 50 20 L50 36 Q42 40 32 40 Q22 40 14 36Z" fill="url(#rn-hood)" stroke="#3A7A3A" stroke-width="1.5"/>
  <!-- Face shadow -->
  <ellipse cx="32" cy="28" rx="13" ry="11" fill="#1A2A1A"/>
  <!-- Eyes -->
  <ellipse cx="27" cy="26" rx="3" ry="2" fill="#66DD66" opacity="0.9"/>
  <ellipse cx="37" cy="26" rx="3" ry="2" fill="#66DD66" opacity="0.9"/>
  <circle cx="27" cy="26" r="1" fill="#1A1A0A"/>
  <circle cx="37" cy="26" r="1" fill="#1A1A0A"/>
  <!-- Mask/scarf -->
  <path d="M20 30 Q32 36 44 30 L44 38 Q32 44 20 38Z" fill="#3A5A3A" opacity="0.8"/>
  <!-- Bow -->
  <path d="M4 10 Q2 32 4 54" fill="none" stroke="#8B6914" stroke-width="2.5" stroke-linecap="round"/>
  <line x1="4" y1="10" x2="4" y2="54" stroke="#D4C9A8" stroke-width="0.8"/>
  <!-- Arrow -->
  <line x1="4" y1="32" x2="22" y2="32" stroke="#8B6914" stroke-width="1.5"/>
  <path d="M22 29 L28 32 L22 35" fill="#C0C0C0" stroke="none"/>
  <!-- Quiver on back -->
  <rect x="50" y="18" width="8" height="30" rx="3" fill="#6A4A1A" stroke="#8B6914" stroke-width="1"/>
  <line x1="52" y1="16" x2="52" y2="20" stroke="#888" stroke-width="1.5"/>
  <line x1="54" y1="14" x2="54" y2="20" stroke="#888" stroke-width="1.5"/>
  <line x1="56" y1="15" x2="56" y2="20" stroke="#888" stroke-width="1.5"/>
  <!-- Shoulders -->
  <path d="M16 38 L12 48 Q14 52 20 50 L22 42Z" fill="#2A4A2A" stroke="#3A6A3A" stroke-width="1"/>
  <path d="M48 38 L52 48 Q50 52 44 50 L42 42Z" fill="#2A4A2A" stroke="#3A6A3A" stroke-width="1"/>
</svg>`;

export const HERO_MAGE = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="mg-robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#4A2A8A"/>
      <stop offset="100%" stop-color="#2A1050"/>
    </linearGradient>
    <filter id="mg-glow"><feGaussianBlur stdDeviation="2" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <!-- Hat -->
  <path d="M32 0 L44 32 L20 32Z" fill="url(#mg-robe)" stroke="#7A5AC0" stroke-width="1.5"/>
  <!-- Hat brim -->
  <ellipse cx="32" cy="32" rx="18" ry="5" fill="#3A1A6A" stroke="#7A5AC0" stroke-width="1"/>
  <!-- Star on hat -->
  <g transform="translate(33,16)" filter="url(#mg-glow)">
    <polygon points="0,-5 1.5,-1.5 5,0 1.5,1.5 0,5 -1.5,1.5 -5,0 -1.5,-1.5" fill="#FFD700"/>
  </g>
  <!-- Face -->
  <ellipse cx="32" cy="38" rx="10" ry="8" fill="#D4B088"/>
  <!-- Eyes -->
  <ellipse cx="28" cy="37" rx="2.5" ry="2" fill="#8844FF" opacity="0.9"/>
  <ellipse cx="36" cy="37" rx="2.5" ry="2" fill="#8844FF" opacity="0.9"/>
  <circle cx="28" cy="37" r="1" fill="#2A1050"/>
  <circle cx="36" cy="37" r="1" fill="#2A1050"/>
  <!-- Beard -->
  <path d="M24 42 Q32 54 40 42" fill="#C0B0A0" stroke="none"/>
  <!-- Robe -->
  <path d="M18 44 L46 44 L50 64 L14 64Z" fill="url(#mg-robe)" stroke="#7A5AC0" stroke-width="1"/>
  <!-- Robe trim -->
  <line x1="14" y1="62" x2="50" y2="62" stroke="#FFD700" stroke-width="1.5"/>
  <!-- Staff -->
  <line x1="54" y1="12" x2="54" y2="62" stroke="#8B6914" stroke-width="3" stroke-linecap="round"/>
  <!-- Orb -->
  <g transform="translate(54,10)" filter="url(#mg-glow)">
    <circle r="6" fill="#7744DD" opacity="0.8"/>
    <circle r="3" fill="#AA88FF" opacity="0.6"/>
    <circle r="1.5" fill="#DDCCFF"/>
  </g>
</svg>`;

export const HERO_PRIEST = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pr-robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E8E0D0"/>
      <stop offset="100%" stop-color="#B0A890"/>
    </linearGradient>
    <filter id="pr-holy"><feGaussianBlur stdDeviation="3" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <!-- Halo -->
  <g filter="url(#pr-holy)">
    <ellipse cx="32" cy="10" rx="14" ry="4" fill="none" stroke="#FFD700" stroke-width="2" opacity="0.7"/>
  </g>
  <!-- Hood/cowl -->
  <path d="M16 36 L16 20 Q16 8 32 6 Q48 8 48 20 L48 36 Q40 40 32 40 Q24 40 16 36Z" fill="url(#pr-robe)" stroke="#C8B898" stroke-width="1.5"/>
  <!-- Face shadow -->
  <ellipse cx="32" cy="28" rx="11" ry="10" fill="#D4C0A0"/>
  <!-- Serene eyes -->
  <path d="M25 27 Q27 25 29 27" fill="none" stroke="#6A5A3A" stroke-width="1.5"/>
  <path d="M35 27 Q37 25 39 27" fill="none" stroke="#6A5A3A" stroke-width="1.5"/>
  <!-- Gentle smile -->
  <path d="M28 32 Q32 35 36 32" fill="none" stroke="#8A7A5A" stroke-width="1"/>
  <!-- Robe body -->
  <path d="M16 38 L48 38 L52 64 L12 64Z" fill="url(#pr-robe)" stroke="#C8B898" stroke-width="1"/>
  <!-- Golden cross on chest -->
  <g transform="translate(32,50)">
    <line x1="0" y1="-6" x2="0" y2="6" stroke="#FFD700" stroke-width="3" stroke-linecap="round"/>
    <line x1="-5" y1="-2" x2="5" y2="-2" stroke="#FFD700" stroke-width="3" stroke-linecap="round"/>
  </g>
  <!-- Healing hands -->
  <g transform="translate(8, 50)" filter="url(#pr-holy)">
    <circle r="4" fill="#66DD66" opacity="0.5"/>
    <circle r="2" fill="#AAFFAA" opacity="0.4"/>
  </g>
  <g transform="translate(56, 50)" filter="url(#pr-holy)">
    <circle r="4" fill="#66DD66" opacity="0.5"/>
    <circle r="2" fill="#AAFFAA" opacity="0.4"/>
  </g>
</svg>`;

export const HERO_SIEGE = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="sg-metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#8A8070"/>
      <stop offset="100%" stop-color="#4A4238"/>
    </linearGradient>
    <linearGradient id="sg-fire" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0%" stop-color="#FF4400"/>
      <stop offset="50%" stop-color="#FF8800"/>
      <stop offset="100%" stop-color="#FFCC00"/>
    </linearGradient>
  </defs>
  <!-- Heavy helmet -->
  <path d="M12 36 L12 18 Q12 2 32 2 Q52 2 52 18 L52 36Z" fill="url(#sg-metal)" stroke="#6A6258" stroke-width="1.5"/>
  <!-- Flat visor -->
  <rect x="16" y="22" width="32" height="10" rx="2" fill="#2A2420" stroke="#6A6258" stroke-width="1"/>
  <!-- Visor slits -->
  <rect x="20" y="25" width="8" height="3" rx="1" fill="#FF660066"/>
  <rect x="36" y="25" width="8" height="3" rx="1" fill="#FF660066"/>
  <!-- Eye glow -->
  <ellipse cx="24" cy="26.5" rx="2.5" ry="1" fill="#FF6600" opacity="0.9"/>
  <ellipse cx="40" cy="26.5" rx="2.5" ry="1" fill="#FF6600" opacity="0.9"/>
  <!-- Rivets -->
  <circle cx="16" cy="16" r="1.5" fill="#A09888"/>
  <circle cx="48" cy="16" r="1.5" fill="#A09888"/>
  <circle cx="16" cy="34" r="1.5" fill="#A09888"/>
  <circle cx="48" cy="34" r="1.5" fill="#A09888"/>
  <!-- Heavy armor body -->
  <path d="M10 36 L54 36 L58 60 Q32 66 6 60Z" fill="url(#sg-metal)" stroke="#6A6258" stroke-width="1.5"/>
  <!-- Bomb/cannonball in hand -->
  <g transform="translate(56,46)">
    <circle r="7" fill="#2A2420" stroke="#4A4238" stroke-width="1.5"/>
    <!-- Fuse -->
    <path d="M0 -7 Q4 -12 6 -10" fill="none" stroke="#8B6914" stroke-width="1.5"/>
    <!-- Spark -->
    <circle cx="6" cy="-10" r="2" fill="url(#sg-fire)" opacity="0.9"/>
  </g>
  <!-- Gear emblem on chest -->
  <g transform="translate(32,48)">
    <circle r="6" fill="none" stroke="#B8A070" stroke-width="1.5"/>
    <circle r="3" fill="none" stroke="#B8A070" stroke-width="1"/>
    <line x1="0" y1="-6" x2="0" y2="6" stroke="#B8A070" stroke-width="1"/>
    <line x1="-6" y1="0" x2="6" y2="0" stroke="#B8A070" stroke-width="1"/>
    <line x1="-4" y1="-4" x2="4" y2="4" stroke="#B8A070" stroke-width="1"/>
    <line x1="4" y1="-4" x2="-4" y2="4" stroke="#B8A070" stroke-width="1"/>
  </g>
</svg>`;

// ── Rank Tier Badges ───────────────────────────────────��────────────────────

export const RANK_BADGE = {
  bronze: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#8B5E3C" stroke="#A0704C" stroke-width="2"/><text x="12" y="16" text-anchor="middle" fill="#D4A96A" font-size="10" font-weight="bold" font-family="serif">B</text></svg>`,
  silver: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#808890" stroke="#A8B0B8" stroke-width="2"/><text x="12" y="16" text-anchor="middle" fill="#E0E4E8" font-size="10" font-weight="bold" font-family="serif">S</text></svg>`,
  gold: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="10" fill="#B8860B" stroke="#FFD700" stroke-width="2"/><text x="12" y="16" text-anchor="middle" fill="#FFD700" font-size="10" font-weight="bold" font-family="serif">G</text></svg>`,
  diamond: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="12,2 22,10 17,22 7,22 2,10" fill="#4488CC" stroke="#66CCFF" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="#CCECFF" font-size="8" font-weight="bold" font-family="serif">D</text></svg>`,
  master: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="12,1 15,9 23,9 17,14 19,22 12,18 5,22 7,14 1,9 9,9" fill="#8B1A8B" stroke="#DD66FF" stroke-width="1.5"/><text x="12" y="16" text-anchor="middle" fill="#FFCCFF" font-size="7" font-weight="bold" font-family="serif">M</text></svg>`,
};

// ── Feature Icons (32x32) ───────────────────────────────────────────────────

export const FEAT_SWORD = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><line x1="6" y1="26" x2="24" y2="4" stroke="#C8960C" stroke-width="2.5" stroke-linecap="round"/><line x1="10" y1="18" x2="18" y2="22" stroke="#C8960C" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="24" r="2.5" fill="none" stroke="#C8960C" stroke-width="1.5"/></svg>`;
export const FEAT_BOT = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="10" width="16" height="14" rx="3" fill="none" stroke="#C8960C" stroke-width="2"/><circle cx="14" cy="17" r="2" fill="#C8960C"/><circle cx="20" cy="17" r="2" fill="#C8960C"/><line x1="16" y1="6" x2="16" y2="10" stroke="#C8960C" stroke-width="2"/><circle cx="16" cy="5" r="2" fill="#C8960C"/><line x1="4" y1="16" x2="8" y2="16" stroke="#C8960C" stroke-width="2"/><line x1="24" y1="16" x2="28" y2="16" stroke="#C8960C" stroke-width="2"/></svg>`;
export const FEAT_BOLT = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><polygon points="18,2 10,16 16,16 12,30 24,14 18,14" fill="#C8960C"/></svg>`;
export const FEAT_COIN = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><ellipse cx="16" cy="16" rx="12" ry="12" fill="none" stroke="#C8960C" stroke-width="2"/><text x="16" y="21" text-anchor="middle" fill="#C8960C" font-size="14" font-weight="bold" font-family="serif">$</text></svg>`;
export const FEAT_TROPHY = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M10 6 L22 6 L20 18 Q16 22 12 18Z" fill="none" stroke="#C8960C" stroke-width="2"/><line x1="16" y1="20" x2="16" y2="26" stroke="#C8960C" stroke-width="2"/><line x1="10" y1="26" x2="22" y2="26" stroke="#C8960C" stroke-width="2.5" stroke-linecap="round"/><path d="M10 8 Q4 8 4 14 Q4 18 10 16" fill="none" stroke="#C8960C" stroke-width="1.5"/><path d="M22 8 Q28 8 28 14 Q28 18 22 16" fill="none" stroke="#C8960C" stroke-width="1.5"/></svg>`;
export const FEAT_CODE = `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M12 8 L4 16 L12 24" fill="none" stroke="#C8960C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 8 L28 16 L20 24" fill="none" stroke="#C8960C" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ── Helper: get rank tier from ELO ───────────────────��──────────────────────

export function getRankTier(elo) {
  if (elo >= 2000) return 'master';
  if (elo >= 1600) return 'diamond';
  if (elo >= 1400) return 'gold';
  if (elo >= 1200) return 'silver';
  return 'bronze';
}

export function getRankName(elo) {
  if (elo >= 2000) return 'Master';
  if (elo >= 1600) return 'Diamond';
  if (elo >= 1400) return 'Gold';
  if (elo >= 1200) return 'Silver';
  return 'Bronze';
}

// ── Hero class icon lookup ──────────────────────────────────────────────────

export const HERO_ICONS = {
  knight: HERO_KNIGHT,
  ranger: HERO_RANGER,
  mage: HERO_MAGE,
  priest: HERO_PRIEST,
  siegemaster: HERO_SIEGE,
};

export const FACTION_ICONS = {
  alliance: ALLIANCE_CREST,
  horde: HORDE_CREST,
};
