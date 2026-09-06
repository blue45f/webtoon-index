import type { FxOverlay } from "./studio-fx-assets";

const INK = "#16100c";
const WHITE = "#ffffff";

function svg(width: number, height: number, body: string): string {
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

function sticker(id: string, label: string, width: number, height: number, body: string): FxOverlay {
  return { id, label, svg: svg(width, height, body), width, height };
}

function shadow(cx: number, cy: number, rx: number, ry: number): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}" opacity="0.13"/>`;
}

function eye(cx: number, cy: number, rx = 8, ry = 11): string {
  const shineX = cx - rx * 0.35;
  const shineY = cy - ry * 0.36;
  const shineR = Math.max(2, rx * 0.32);
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${INK}"/><circle cx="${shineX}" cy="${shineY}" r="${shineR}" fill="${WHITE}"/>`;
}

function cheek(cx: number, cy: number, rx = 10, ry = 5, fill = "#ff9fb0"): string {
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}" opacity="0.75"/>`;
}

export const CREATURE_STICKERS: FxOverlay[] = [
  sticker(
    "cr-cat",
    "고양이",
    260,
    260,
    `${shadow(132, 226, 76, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M176 174 C216 148 238 176 210 204 C192 222 166 207 160 190" fill="none" stroke="${INK}" stroke-width="25"/>` +
      `<path d="M176 174 C216 148 238 176 210 204 C192 222 166 207 160 190" fill="none" stroke="#f3a85f" stroke-width="15"/>` +
      `<ellipse cx="132" cy="172" rx="72" ry="62" fill="#f6b66f"/>` +
      `<path d="M72 92 L92 38 L126 86 Z" fill="#f4a95e"/>` +
      `<path d="M190 92 L168 38 L136 86 Z" fill="#f4a95e"/>` +
      `<path d="M87 80 L96 56 L113 82 Z" fill="#ffb6bb" stroke-width="4"/>` +
      `<path d="M175 80 L164 56 L147 82 Z" fill="#ffb6bb" stroke-width="4"/>` +
      `<ellipse cx="132" cy="118" rx="78" ry="65" fill="#ffc477"/>` +
      `<path d="M132 132 L123 141 L141 141 Z" fill="#e77482" stroke-width="4"/>` +
      `<path d="M132 142 C126 153 115 153 110 145 M132 142 C138 153 149 153 154 145" fill="none" stroke-width="4"/>` +
      `<path d="M58 124 L28 116 M58 137 L30 140 M204 124 L234 116 M204 137 L232 140" fill="none" stroke-width="4"/>` +
      `<ellipse cx="92" cy="206" rx="21" ry="16" fill="#ffd199"/>` +
      `<ellipse cx="164" cy="206" rx="21" ry="16" fill="#ffd199"/>` +
      `</g>` +
      `${eye(101, 116, 8, 12)}${eye(163, 116, 8, 12)}${cheek(82, 139)}${cheek(184, 139)}`,
  ),
  sticker(
    "cr-dog",
    "강아지",
    260,
    260,
    `${shadow(132, 226, 82, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="132" cy="174" rx="70" ry="58" fill="#d98c4a"/>` +
      `<path d="M72 96 C46 88 32 111 36 141 C41 178 70 181 87 153 Z" fill="#9b5a34"/>` +
      `<path d="M188 96 C216 88 231 111 226 141 C221 178 191 181 175 153 Z" fill="#9b5a34"/>` +
      `<ellipse cx="132" cy="118" rx="75" ry="65" fill="#d99a5f"/>` +
      `<path d="M91 114 C98 95 113 85 132 86 C151 85 166 95 173 114 C160 105 145 105 132 108 C119 105 104 105 91 114 Z" fill="#b87745"/>` +
      `<ellipse cx="132" cy="143" rx="30" ry="24" fill="#ffe2bc"/>` +
      `<path d="M132 130 C145 130 150 138 141 145 C134 151 126 151 119 145 C110 138 117 130 132 130 Z" fill="#6b3b2a" stroke-width="4"/>` +
      `<path d="M132 146 C127 155 118 157 113 149 M132 146 C137 155 146 157 151 149" fill="none" stroke-width="4"/>` +
      `<path d="M76 205 C56 197 53 177 69 169 C84 162 98 176 92 192" fill="#d98c4a"/>` +
      `<path d="M184 205 C204 197 207 177 191 169 C176 162 162 176 168 192" fill="#d98c4a"/>` +
      `</g>` +
      `${eye(103, 118, 8, 12)}${eye(161, 118, 8, 12)}${cheek(87, 149, 11, 5, "#ff9c97")}${cheek(177, 149, 11, 5, "#ff9c97")}`,
  ),
  sticker(
    "cr-rabbit",
    "토끼",
    250,
    280,
    `${shadow(124, 252, 76, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M84 95 C48 38 64 13 92 22 C119 30 121 78 111 113 Z" fill="#f4f1ea"/>` +
      `<path d="M156 95 C191 38 176 13 148 22 C121 30 119 78 129 113 Z" fill="#f4f1ea"/>` +
      `<path d="M89 83 C68 43 76 33 90 38 C105 44 104 75 101 96 Z" fill="#ffc3cc" stroke-width="4"/>` +
      `<path d="M151 83 C172 43 164 33 150 38 C135 44 136 75 139 96 Z" fill="#ffc3cc" stroke-width="4"/>` +
      `<ellipse cx="124" cy="185" rx="72" ry="64" fill="#f2eee7"/>` +
      `<ellipse cx="124" cy="132" rx="76" ry="66" fill="#fff7ef"/>` +
      `<path d="M124 142 L116 151 L132 151 Z" fill="#f08c9c" stroke-width="4"/>` +
      `<path d="M124 152 C119 160 111 161 106 154 M124 152 C129 160 137 161 142 154" fill="none" stroke-width="4"/>` +
      `<ellipse cx="86" cy="221" rx="22" ry="17" fill="#fff7ef"/>` +
      `<ellipse cx="158" cy="221" rx="22" ry="17" fill="#fff7ef"/>` +
      `<path d="M174 199 L220 184 L207 218 Z" fill="#ff8f45"/>` +
      `<path d="M210 184 C218 172 230 172 237 180 M217 191 C229 185 238 190 242 199" fill="none" stroke="#52a65b" stroke-width="5"/>` +
      `</g>` +
      `${eye(97, 131, 8, 12)}${eye(149, 131, 8, 12)}${cheek(80, 155, 11, 5)}${cheek(166, 155, 11, 5)}`,
  ),
  sticker(
    "cr-bear",
    "곰",
    250,
    260,
    `${shadow(126, 229, 78, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="78" cy="82" rx="31" ry="32" fill="#9f6b3f"/>` +
      `<ellipse cx="172" cy="82" rx="31" ry="32" fill="#9f6b3f"/>` +
      `<ellipse cx="78" cy="84" rx="16" ry="17" fill="#d7a475" stroke-width="4"/>` +
      `<ellipse cx="172" cy="84" rx="16" ry="17" fill="#d7a475" stroke-width="4"/>` +
      `<ellipse cx="126" cy="177" rx="69" ry="58" fill="#a87345"/>` +
      `<ellipse cx="126" cy="119" rx="80" ry="72" fill="#b98250"/>` +
      `<ellipse cx="126" cy="145" rx="36" ry="29" fill="#f2c89b"/>` +
      `<path d="M126 130 C139 130 145 137 137 145 C131 151 121 151 115 145 C107 137 113 130 126 130 Z" fill="#5b3428" stroke-width="4"/>` +
      `<path d="M126 147 C121 157 111 158 106 150 M126 147 C131 157 141 158 146 150" fill="none" stroke-width="4"/>` +
      `<circle cx="75" cy="196" r="20" fill="#b98250"/>` +
      `<circle cx="173" cy="196" r="20" fill="#b98250"/>` +
      `</g>` +
      `${eye(97, 116, 8, 11)}${eye(153, 116, 8, 11)}${cheek(82, 151, 10, 5, "#ff9c92")}${cheek(170, 151, 10, 5, "#ff9c92")}`,
  ),
  sticker(
    "cr-fox",
    "여우",
    280,
    260,
    `${shadow(142, 228, 84, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M187 178 C238 142 267 171 237 209 C213 238 172 219 166 190 Z" fill="#ee8742"/>` +
      `<path d="M225 158 C254 159 267 177 253 197 C244 210 230 209 215 200 Z" fill="#fff2de"/>` +
      `<ellipse cx="137" cy="174" rx="67" ry="57" fill="#ec8843"/>` +
      `<path d="M67 105 L92 42 L125 103 Z" fill="#ec8843"/>` +
      `<path d="M207 105 L181 42 L149 103 Z" fill="#ec8843"/>` +
      `<path d="M90 88 L98 62 L112 91 Z" fill="#ffbd9a" stroke-width="4"/>` +
      `<path d="M181 88 L173 62 L158 91 Z" fill="#ffbd9a" stroke-width="4"/>` +
      `<path d="M137 53 C179 55 210 89 211 122 C211 165 179 189 137 189 C95 189 63 165 63 122 C64 89 95 55 137 53 Z" fill="#f1974d"/>` +
      `<path d="M73 125 C91 158 107 172 137 172 C167 172 184 158 201 125 C177 134 154 134 137 130 C119 134 96 134 73 125 Z" fill="#fff2de"/>` +
      `<path d="M137 135 L126 145 L148 145 Z" fill="#5a3428" stroke-width="4"/>` +
      `<path d="M137 145 C132 153 123 153 118 146 M137 145 C142 153 151 153 156 146" fill="none" stroke-width="4"/>` +
      `</g>` +
      `${eye(108, 119, 8, 11)}${eye(166, 119, 8, 11)}${cheek(92, 147, 10, 5, "#ff9c90")}${cheek(174, 147, 10, 5, "#ff9c90")}`,
  ),
  sticker(
    "cr-penguin",
    "펭귄",
    250,
    270,
    `${shadow(126, 241, 74, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M75 137 C45 151 39 187 58 203 C74 217 91 199 94 172 Z" fill="#263442"/>` +
      `<path d="M176 137 C207 151 213 187 194 203 C178 217 161 199 158 172 Z" fill="#263442"/>` +
      `<ellipse cx="126" cy="156" rx="74" ry="89" fill="#263442"/>` +
      `<ellipse cx="126" cy="167" rx="51" ry="66" fill="#fff5e9"/>` +
      `<path d="M64 105 C71 63 102 39 126 39 C150 39 181 63 188 105 C167 93 149 88 126 88 C103 88 84 93 64 105 Z" fill="#263442"/>` +
      `<ellipse cx="126" cy="103" rx="55" ry="47" fill="#fff5e9"/>` +
      `<path d="M126 115 L105 130 L126 144 L147 130 Z" fill="#ffae3d"/>` +
      `<ellipse cx="96" cy="229" rx="24" ry="12" fill="#ffae3d"/>` +
      `<ellipse cx="154" cy="229" rx="24" ry="12" fill="#ffae3d"/>` +
      `</g>` +
      `${eye(104, 96, 8, 12)}${eye(152, 96, 8, 12)}${cheek(85, 122, 10, 5, "#ff9da5")}${cheek(171, 122, 10, 5, "#ff9da5")}`,
  ),
  sticker(
    "cr-panda",
    "판다",
    260,
    260,
    `${shadow(130, 229, 80, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="75" cy="79" rx="31" ry="32" fill="#1f2429"/>` +
      `<ellipse cx="185" cy="79" rx="31" ry="32" fill="#1f2429"/>` +
      `<ellipse cx="130" cy="178" rx="68" ry="56" fill="#f7f2ea"/>` +
      `<ellipse cx="130" cy="123" rx="80" ry="72" fill="#fffaf2"/>` +
      `<ellipse cx="96" cy="121" rx="25" ry="29" fill="#1f2429" transform="rotate(-18 96 121)"/>` +
      `<ellipse cx="164" cy="121" rx="25" ry="29" fill="#1f2429" transform="rotate(18 164 121)"/>` +
      `<ellipse cx="130" cy="147" rx="31" ry="26" fill="#f1dcc8"/>` +
      `<path d="M130 133 C141 133 146 139 139 146 C133 152 125 152 119 146 C112 139 119 133 130 133 Z" fill="#2c2420" stroke-width="4"/>` +
      `<path d="M130 148 C125 157 116 157 111 150 M130 148 C135 157 144 157 149 150" fill="none" stroke-width="4"/>` +
      `<path d="M50 182 C33 171 30 151 43 142 C58 132 74 146 73 166 Z" fill="#1f2429"/>` +
      `<path d="M204 176 L232 117" fill="none" stroke="#4b8f43" stroke-width="9"/>` +
      `<path d="M218 143 C235 139 244 147 248 158 M224 128 C232 113 246 110 255 118" fill="none" stroke="#68b65a" stroke-width="5"/>` +
      `</g>` +
      `${eye(97, 122, 7, 10)}${eye(163, 122, 7, 10)}${cheek(84, 153, 10, 5, "#ff9fa8")}${cheek(176, 153, 10, 5, "#ff9fa8")}`,
  ),
  sticker(
    "cr-chick",
    "병아리",
    230,
    240,
    `${shadow(115, 217, 67, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M93 48 C99 25 119 25 124 48 C112 41 104 41 93 48 Z" fill="#ffd44a"/>` +
      `<ellipse cx="115" cy="148" rx="72" ry="75" fill="#ffd84d"/>` +
      `<ellipse cx="70" cy="158" rx="26" ry="19" fill="#ffe778"/>` +
      `<ellipse cx="165" cy="158" rx="26" ry="19" fill="#ffe778"/>` +
      `<ellipse cx="115" cy="106" rx="58" ry="52" fill="#ffe26b"/>` +
      `<path d="M115 119 L95 133 L115 146 L135 133 Z" fill="#ff9942"/>` +
      `<path d="M90 207 L78 223 M92 207 L101 223 M142 207 L132 223 M144 207 L154 223" fill="none" stroke="#ef8e34" stroke-width="5"/>` +
      `</g>` +
      `${eye(91, 103, 8, 11)}${eye(139, 103, 8, 11)}${cheek(74, 130, 10, 5, "#ff9da1")}${cheek(156, 130, 10, 5, "#ff9da1")}`,
  ),
  sticker(
    "cr-hamster",
    "햄스터",
    250,
    240,
    `${shadow(126, 215, 76, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="77" cy="80" rx="28" ry="29" fill="#d59a63"/>` +
      `<ellipse cx="174" cy="80" rx="28" ry="29" fill="#d59a63"/>` +
      `<ellipse cx="77" cy="82" rx="14" ry="15" fill="#ffd2b8" stroke-width="4"/>` +
      `<ellipse cx="174" cy="82" rx="14" ry="15" fill="#ffd2b8" stroke-width="4"/>` +
      `<ellipse cx="126" cy="155" rx="72" ry="66" fill="#d59a63"/>` +
      `<ellipse cx="126" cy="112" rx="76" ry="62" fill="#e2ad75"/>` +
      `<ellipse cx="94" cy="137" rx="24" ry="24" fill="#ffe0c2"/>` +
      `<ellipse cx="157" cy="137" rx="24" ry="24" fill="#ffe0c2"/>` +
      `<ellipse cx="126" cy="139" rx="25" ry="20" fill="#ffe9d4"/>` +
      `<path d="M126 130 L118 138 L134 138 Z" fill="#7b4935" stroke-width="4"/>` +
      `<path d="M126 140 C121 148 113 148 109 142 M126 140 C131 148 139 148 143 142" fill="none" stroke-width="4"/>` +
      `<path d="M105 186 C111 174 121 174 126 186 C131 174 141 174 147 186" fill="#f5c08f"/>` +
      `<ellipse cx="126" cy="192" rx="14" ry="9" fill="#f0cf82"/>` +
      `</g>` +
      `${eye(101, 108, 7, 10)}${eye(151, 108, 7, 10)}${cheek(72, 145, 10, 5)}${cheek(181, 145, 10, 5)}`,
  ),
  sticker(
    "cr-frog",
    "개구리",
    250,
    240,
    `${shadow(126, 217, 78, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="82" cy="78" r="31" fill="#8fd768"/>` +
      `<circle cx="168" cy="78" r="31" fill="#8fd768"/>` +
      `<ellipse cx="126" cy="149" rx="82" ry="72" fill="#8fd768"/>` +
      `<path d="M67 142 C82 182 104 196 126 196 C148 196 170 182 185 142 C163 157 149 164 126 164 C103 164 89 157 67 142 Z" fill="#c8ef93"/>` +
      `<path d="M104 146 C113 156 139 156 148 146" fill="none" stroke-width="4"/>` +
      `<ellipse cx="76" cy="184" rx="26" ry="17" fill="#78c85c"/>` +
      `<ellipse cx="177" cy="184" rx="26" ry="17" fill="#78c85c"/>` +
      `</g>` +
      `${eye(82, 78, 9, 12)}${eye(168, 78, 9, 12)}${cheek(73, 139, 11, 5, "#ff98a0")}${cheek(180, 139, 11, 5, "#ff98a0")}`,
  ),
  sticker(
    "cr-lion",
    "사자",
    270,
    270,
    `${shadow(135, 240, 82, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M135 37 C153 28 172 39 176 61 C199 58 216 73 214 96 C235 108 241 133 225 151 C235 174 222 199 199 202 C191 225 167 234 148 220 C128 235 103 228 95 205 C70 205 52 186 58 162 C36 149 35 122 55 106 C49 83 65 61 89 62 C94 39 116 28 135 37 Z" fill="#d98636"/>` +
      `<ellipse cx="135" cy="151" rx="72" ry="70" fill="#f0b45f"/>` +
      `<ellipse cx="105" cy="86" rx="18" ry="17" fill="#f0b45f"/>` +
      `<ellipse cx="170" cy="86" rx="18" ry="17" fill="#f0b45f"/>` +
      `<ellipse cx="135" cy="158" rx="34" ry="29" fill="#ffe0a3"/>` +
      `<path d="M135 143 C148 143 154 151 145 158 C138 164 130 164 123 158 C114 151 122 143 135 143 Z" fill="#6a3c2d" stroke-width="4"/>` +
      `<path d="M135 160 C129 170 119 170 114 162 M135 160 C141 170 151 170 156 162" fill="none" stroke-width="4"/>` +
      `<path d="M80 205 C65 195 64 176 78 170 C94 163 106 179 101 195" fill="#f0b45f"/>` +
      `<path d="M190 205 C205 195 206 176 192 170 C176 163 164 179 169 195" fill="#f0b45f"/>` +
      `</g>` +
      `${eye(109, 135, 8, 11)}${eye(161, 135, 8, 11)}${cheek(91, 164, 10, 5, "#ff9c92")}${cheek(179, 164, 10, 5, "#ff9c92")}`,
  ),
  sticker(
    "cr-tiger",
    "호랑이",
    270,
    260,
    `${shadow(136, 231, 82, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="82" cy="78" rx="30" ry="31" fill="#f29a39"/>` +
      `<ellipse cx="184" cy="78" rx="30" ry="31" fill="#f29a39"/>` +
      `<ellipse cx="82" cy="80" rx="15" ry="16" fill="#ffd4a5" stroke-width="4"/>` +
      `<ellipse cx="184" cy="80" rx="15" ry="16" fill="#ffd4a5" stroke-width="4"/>` +
      `<ellipse cx="136" cy="176" rx="70" ry="57" fill="#f29a39"/>` +
      `<ellipse cx="136" cy="118" rx="79" ry="68" fill="#ffaa4d"/>` +
      `<path d="M136 57 L126 91 L146 91 Z M101 66 L111 103 M172 66 L161 103" fill="none" stroke-width="6"/>` +
      `<path d="M73 112 L103 119 M73 139 L104 134 M199 112 L169 119 M199 139 L168 134" fill="none" stroke-width="5"/>` +
      `<ellipse cx="136" cy="144" rx="35" ry="29" fill="#ffe0b5"/>` +
      `<path d="M136 130 C149 130 155 138 146 145 C140 151 132 151 126 145 C117 138 123 130 136 130 Z" fill="#5f382d" stroke-width="4"/>` +
      `<path d="M136 146 C131 156 121 156 116 148 M136 146 C141 156 151 156 156 148" fill="none" stroke-width="4"/>` +
      `</g>` +
      `${eye(107, 116, 8, 11)}${eye(165, 116, 8, 11)}${cheek(89, 148, 10, 5, "#ff998f")}${cheek(183, 148, 10, 5, "#ff998f")}`,
  ),
  sticker(
    "cr-pig",
    "돼지",
    250,
    250,
    `${shadow(126, 222, 78, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M72 91 C48 66 58 42 86 47 C108 51 107 78 95 100 Z" fill="#ff9fb1"/>` +
      `<path d="M178 91 C202 66 192 42 164 47 C142 51 143 78 155 100 Z" fill="#ff9fb1"/>` +
      `<path d="M80 82 C67 65 73 57 87 60 C97 62 97 76 91 88 Z" fill="#ffc0cb" stroke-width="4"/>` +
      `<path d="M170 82 C183 65 177 57 163 60 C153 62 153 76 159 88 Z" fill="#ffc0cb" stroke-width="4"/>` +
      `<ellipse cx="126" cy="168" rx="69" ry="56" fill="#ffadbd"/>` +
      `<ellipse cx="126" cy="119" rx="78" ry="66" fill="#ffb7c5"/>` +
      `<ellipse cx="126" cy="143" rx="33" ry="24" fill="#ff8fa5"/>` +
      `<ellipse cx="116" cy="143" rx="4" ry="7" fill="${INK}" stroke="none"/>` +
      `<ellipse cx="136" cy="143" rx="4" ry="7" fill="${INK}" stroke="none"/>` +
      `<path d="M111 164 C120 172 139 172 148 164" fill="none" stroke-width="4"/>` +
      `<path d="M78 194 C62 186 61 169 74 163 C88 157 100 171 96 187" fill="#ffadbd"/>` +
      `<path d="M182 194 C198 186 199 169 186 163 C172 157 160 171 164 187" fill="#ffadbd"/>` +
      `</g>` +
      `${eye(96, 113, 8, 11)}${eye(154, 113, 8, 11)}${cheek(78, 150, 10, 5, "#ff7894")}${cheek(172, 150, 10, 5, "#ff7894")}`,
  ),
  sticker(
    "cr-raccoon",
    "너구리",
    270,
    260,
    `${shadow(137, 230, 82, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M186 178 C231 154 260 183 235 211 C213 236 177 216 169 190 Z" fill="#9aa0a4"/>` +
      `<path d="M202 166 L225 210 M224 162 L247 198" fill="none" stroke="#4a4b4b" stroke-width="9"/>` +
      `<ellipse cx="82" cy="83" rx="29" ry="30" fill="#8b8f92"/>` +
      `<ellipse cx="177" cy="83" rx="29" ry="30" fill="#8b8f92"/>` +
      `<ellipse cx="135" cy="176" rx="69" ry="57" fill="#8b8f92"/>` +
      `<ellipse cx="135" cy="120" rx="78" ry="68" fill="#a5aaad"/>` +
      `<path d="M64 118 C86 90 109 89 135 113 C162 89 185 90 207 118 C183 135 158 136 135 124 C112 136 88 135 64 118 Z" fill="#3d4347"/>` +
      `<path d="M84 145 C100 164 116 172 135 172 C154 172 170 164 186 145 C166 153 151 154 135 151 C119 154 104 153 84 145 Z" fill="#f0dcc7"/>` +
      `<path d="M135 136 L124 146 L146 146 Z" fill="#3a2924" stroke-width="4"/>` +
      `<path d="M135 147 C130 156 121 156 116 149 M135 147 C140 156 149 156 154 149" fill="none" stroke-width="4"/>` +
      `</g>` +
      `${eye(105, 118, 7, 10)}${eye(165, 118, 7, 10)}${cheek(90, 151, 10, 5, "#ff9aa1")}${cheek(178, 151, 10, 5, "#ff9aa1")}`,
  ),
  sticker(
    "cr-owl",
    "부엉이",
    250,
    250,
    `${shadow(126, 222, 76, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M72 67 L95 88 L126 57 L157 88 L180 67 C195 99 202 129 196 159 C188 202 158 225 126 225 C92 225 63 202 55 159 C49 129 56 99 72 67 Z" fill="#a87342"/>` +
      `<path d="M72 148 C83 187 101 207 126 207 C151 207 169 187 180 148 C157 164 142 170 126 170 C110 170 94 164 72 148 Z" fill="#d7a25e"/>` +
      `<circle cx="99" cy="116" r="29" fill="#fff4d6"/>` +
      `<circle cx="153" cy="116" r="29" fill="#fff4d6"/>` +
      `<path d="M126 128 L112 146 L126 154 L140 146 Z" fill="#f6a642"/>` +
      `<path d="M59 143 C36 158 39 192 65 197 C78 181 79 160 70 142 Z" fill="#8e633c"/>` +
      `<path d="M193 143 C216 158 213 192 187 197 C174 181 173 160 182 142 Z" fill="#8e633c"/>` +
      `</g>` +
      `${eye(99, 116, 9, 12)}${eye(153, 116, 9, 12)}${cheek(83, 145, 9, 5, "#ff9a93")}${cheek(169, 145, 9, 5, "#ff9a93")}`,
  ),
  sticker(
    "cr-hedgehog",
    "고슴도치",
    280,
    250,
    `${shadow(141, 222, 86, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M54 154 L35 129 L66 126 L52 94 L88 104 L83 70 L116 89 L129 56 L150 88 L179 65 L181 101 L216 91 L202 126 L236 132 L212 155 C209 207 168 229 124 223 C82 218 54 188 54 154 Z" fill="#8f613c"/>` +
      `<ellipse cx="134" cy="154" rx="80" ry="68" fill="#c99562"/>` +
      `<path d="M68 151 C83 185 101 197 128 197 C154 197 175 185 192 151 C169 162 152 166 132 166 C110 166 91 162 68 151 Z" fill="#f2cfaa"/>` +
      `<ellipse cx="101" cy="87" rx="16" ry="14" fill="#c99562"/>` +
      `<ellipse cx="165" cy="87" rx="16" ry="14" fill="#c99562"/>` +
      `<path d="M132 136 L122 146 L144 146 Z" fill="#68402e" stroke-width="4"/>` +
      `<path d="M132 147 C126 156 117 156 112 148 M132 147 C138 156 147 156 152 148" fill="none" stroke-width="4"/>` +
      `<path d="M76 117 L55 108 M90 97 L74 80 M190 118 L210 108 M174 96 L190 80" fill="none" stroke="#6d472d" stroke-width="5"/>` +
      `</g>` +
      `${eye(105, 125, 8, 11)}${eye(157, 125, 8, 11)}${cheek(89, 151, 10, 5, "#ff9b95")}${cheek(173, 151, 10, 5, "#ff9b95")}`,
  ),
  sticker(
    "cr-slime",
    "슬라임 캐릭터",
    240,
    220,
    `${shadow(120, 199, 75, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M120 34 C158 36 191 66 198 111 C204 154 180 190 120 190 C60 190 36 154 42 111 C49 66 82 36 120 34 Z" fill="#78d7d8"/>` +
      `<path d="M67 145 C78 165 94 173 120 173 C146 173 162 165 173 145 C154 154 137 158 120 158 C103 158 86 154 67 145 Z" fill="#a9eeee"/>` +
      `<path d="M84 53 C103 40 135 42 151 55" fill="none" stroke="#d4ffff" stroke-width="8" opacity="0.9"/>` +
      `<circle cx="72" cy="171" r="13" fill="#78d7d8"/>` +
      `<circle cx="185" cy="166" r="10" fill="#78d7d8"/>` +
      `<path d="M96 128 C106 139 136 139 146 128" fill="none" stroke-width="4"/>` +
      `</g>` +
      `${eye(93, 104, 9, 12)}${eye(145, 104, 9, 12)}${cheek(76, 130, 11, 5, "#ff9fb0")}${cheek(162, 130, 11, 5, "#ff9fb0")}`,
  ),
  sticker(
    "cr-robot",
    "로봇 마스코트",
    250,
    250,
    `${shadow(126, 222, 76, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M126 52 L126 30" fill="none" stroke-width="6"/>` +
      `<circle cx="126" cy="24" r="11" fill="#ffcf4d"/>` +
      `<rect x="53" y="75" width="146" height="118" rx="30" fill="#9ed4e6"/>` +
      `<rect x="76" y="102" width="100" height="64" rx="21" fill="#f7fbff"/>` +
      `<rect x="31" y="111" width="24" height="55" rx="12" fill="#86b8c8"/>` +
      `<rect x="197" y="111" width="24" height="55" rx="12" fill="#86b8c8"/>` +
      `<path d="M82 194 L70 223 M154 194 L165 223" fill="none" stroke="#86b8c8" stroke-width="12"/>` +
      `<circle cx="101" cy="211" r="13" fill="#86b8c8"/>` +
      `<circle cx="160" cy="211" r="13" fill="#86b8c8"/>` +
      `<path d="M105 147 C114 155 138 155 147 147" fill="none" stroke-width="4"/>` +
      `<circle cx="81" cy="84" r="8" fill="#ff8ca0" stroke-width="4"/>` +
      `<circle cx="171" cy="84" r="8" fill="#ff8ca0" stroke-width="4"/>` +
      `</g>` +
      `${eye(99, 130, 8, 10)}${eye(151, 130, 8, 10)}${cheek(86, 150, 9, 5, "#ff9da5")}${cheek(164, 150, 9, 5, "#ff9da5")}`,
  ),
  sticker(
    "cr-star-fairy",
    "별 요정",
    280,
    260,
    `${shadow(140, 229, 78, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M70 126 C38 95 52 61 94 80 C98 42 132 28 150 68 C183 45 214 66 195 105 C239 112 250 149 210 168 C226 205 193 230 159 205 C133 236 96 218 101 179 C60 186 38 154 70 126 Z" fill="#ffd95a"/>` +
      `<path d="M100 93 C125 75 162 77 182 99 C164 91 145 89 124 95 C113 98 105 101 100 93 Z" fill="#ffe98c" stroke-width="4"/>` +
      `<path d="M76 140 C58 132 45 145 46 162 C47 181 66 188 82 176" fill="#c8f0ff"/>` +
      `<path d="M207 139 C226 131 238 145 237 162 C236 181 217 188 201 176" fill="#c8f0ff"/>` +
      `<path d="M138 160 L128 171 L150 171 Z" fill="#f19a55" stroke-width="4"/>` +
      `<path d="M138 172 C132 181 122 181 117 173 M138 172 C144 181 154 181 159 173" fill="none" stroke-width="4"/>` +
      `<path d="M204 91 L244 55 M234 47 L252 36 M240 69 L260 72" fill="none" stroke="#8f73ff" stroke-width="6"/>` +
      `<path d="M249 34 L253 45 L265 45 L255 52 L259 64 L249 57 L239 64 L243 52 L233 45 L245 45 Z" fill="#ffb7d1"/>` +
      `</g>` +
      `${eye(114, 143, 8, 11)}${eye(164, 143, 8, 11)}${cheek(95, 169, 10, 5, "#ff9da8")}${cheek(181, 169, 10, 5, "#ff9da8")}`,
  ),
  sticker(
    "cr-ghost",
    "유령 캐릭터",
    240,
    260,
    `${shadow(121, 232, 70, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M121 37 C165 37 191 72 191 121 L191 213 C178 204 166 204 153 219 C140 203 126 203 114 219 C101 203 87 203 74 219 C61 204 50 204 39 213 L39 121 C39 72 76 37 121 37 Z" fill="#f8fbff"/>` +
      `<path d="M72 70 C93 52 134 50 156 68" fill="none" stroke="#d7ecff" stroke-width="8"/>` +
      `<path d="M96 142 C105 153 135 153 145 142" fill="none" stroke-width="4"/>` +
      `<path d="M47 139 C26 136 24 106 47 99 M193 139 C214 136 216 106 193 99" fill="none" stroke-width="8"/>` +
      `</g>` +
      `${eye(93, 112, 9, 13)}${eye(143, 112, 9, 13)}${cheek(75, 143, 10, 5, "#ffadb6")}${cheek(160, 143, 10, 5, "#ffadb6")}`,
  ),
  sticker(
    "cr-mushroom",
    "버섯 캐릭터",
    250,
    250,
    `${shadow(126, 224, 75, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M45 117 C48 65 83 37 126 37 C169 37 204 65 207 117 C173 135 85 135 45 117 Z" fill="#ef5d6c"/>` +
      `<circle cx="86" cy="86" r="17" fill="#fff4e5"/>` +
      `<circle cx="135" cy="63" r="19" fill="#fff4e5"/>` +
      `<circle cx="170" cy="103" r="16" fill="#fff4e5"/>` +
      `<path d="M75 124 C85 108 104 104 126 104 C148 104 167 108 177 124 L171 184 C166 213 148 226 126 226 C104 226 86 213 81 184 Z" fill="#ffe0b5"/>` +
      `<path d="M87 181 C98 197 111 204 126 204 C141 204 154 197 165 181 C146 188 138 190 126 190 C114 190 103 188 87 181 Z" fill="#ffd0a1"/>` +
      `<path d="M106 163 C115 172 137 172 146 163" fill="none" stroke-width="4"/>` +
      `<path d="M60 124 C43 134 42 157 59 165 M193 124 C210 134 211 157 194 165" fill="none" stroke="#ef5d6c" stroke-width="10"/>` +
      `</g>` +
      `${eye(103, 143, 8, 11)}${eye(151, 143, 8, 11)}${cheek(87, 167, 10, 5, "#ff9da7")}${cheek(167, 167, 10, 5, "#ff9da7")}`,
  ),
  sticker(
    "cr-baby-dragon",
    "드래곤 베이비",
    280,
    270,
    `${shadow(140, 241, 83, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M195 166 C234 132 264 158 244 193 C225 226 186 211 174 186 Z" fill="#87d06a"/>` +
      `<path d="M206 158 L242 184 L210 191 Z" fill="#b8f0a7" stroke-width="5"/>` +
      `<path d="M70 139 C43 119 54 89 83 95 C93 72 123 80 119 111 Z" fill="#bfe7ff"/>` +
      `<path d="M190 139 C217 119 206 89 177 95 C167 72 137 80 141 111 Z" fill="#bfe7ff"/>` +
      `<ellipse cx="139" cy="177" rx="71" ry="58" fill="#76c962"/>` +
      `<ellipse cx="139" cy="121" rx="76" ry="65" fill="#88d977"/>` +
      `<path d="M102 64 L111 36 L127 70 Z" fill="#ffd471"/>` +
      `<path d="M171 64 L163 36 L146 70 Z" fill="#ffd471"/>` +
      `<path d="M122 51 L139 25 L156 51" fill="#ffd471"/>` +
      `<path d="M100 154 C112 171 127 178 139 178 C151 178 166 171 178 154 C161 162 151 165 139 165 C127 165 117 162 100 154 Z" fill="#c5f0a5"/>` +
      `<path d="M139 138 L128 148 L150 148 Z" fill="#52743e" stroke-width="4"/>` +
      `<path d="M139 149 C133 158 124 158 119 150 M139 149 C145 158 154 158 159 150" fill="none" stroke-width="4"/>` +
      `<path d="M85 199 C68 194 63 177 75 168 C89 158 105 170 104 187" fill="#76c962"/>` +
      `</g>` +
      `${eye(111, 123, 8, 12)}${eye(165, 123, 8, 12)}${cheek(93, 152, 10, 5, "#ff9fa9")}${cheek(181, 152, 10, 5, "#ff9fa9")}`,
  ),
  sticker(
    "cr-cat-wizard",
    "고양이 마법사",
    270,
    280,
    `${shadow(137, 252, 80, 15)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M111 104 L145 16 L178 104 Z" fill="#7460d9"/>` +
      `<path d="M126 56 C145 48 162 53 171 66" fill="none" stroke="#ffd15a" stroke-width="7"/>` +
      `<path d="M88 105 C119 92 164 92 198 105 C183 122 106 122 88 105 Z" fill="#5b4fc4"/>` +
      `<path d="M76 139 L96 88 L127 135 Z" fill="#d89657"/>` +
      `<path d="M194 139 L172 88 L143 135 Z" fill="#d89657"/>` +
      `<ellipse cx="136" cy="202" rx="70" ry="56" fill="#5b4fc4"/>` +
      `<path d="M88 202 C96 232 113 247 136 247 C159 247 176 232 184 202 C164 212 151 216 136 216 C121 216 108 212 88 202 Z" fill="#7d6df0"/>` +
      `<ellipse cx="136" cy="148" rx="74" ry="63" fill="#e8a866"/>` +
      `<path d="M86 137 C107 164 119 173 136 173 C153 173 166 164 186 137 C166 147 153 150 136 150 C119 150 105 147 86 137 Z" fill="#ffe1ad"/>` +
      `<path d="M136 139 L126 148 L148 148 Z" fill="#5d3429" stroke-width="4"/>` +
      `<path d="M136 149 C131 158 121 158 116 150 M136 149 C141 158 151 158 156 150" fill="none" stroke-width="4"/>` +
      `<path d="M202 158 L245 116 M239 108 L257 93 M246 128 L263 133" fill="none" stroke="#ffd15a" stroke-width="6"/>` +
      `<path d="M253 88 L257 99 L269 99 L259 106 L263 117 L253 111 L243 117 L247 106 L237 99 L249 99 Z" fill="#ffe983"/>` +
      `</g>` +
      `${eye(110, 132, 8, 11)}${eye(162, 132, 8, 11)}${cheek(94, 155, 10, 5, "#ff9aa1")}${cheek(178, 155, 10, 5, "#ff9aa1")}`,
  ),
  sticker(
    "cr-little-angel",
    "꼬마 천사",
    250,
    270,
    `${shadow(126, 241, 75, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="126" cy="38" rx="45" ry="14" fill="none" stroke="#ffd95a" stroke-width="8"/>` +
      `<path d="M70 156 C34 137 37 94 78 99 C102 102 109 130 97 153 Z" fill="#e8f6ff"/>` +
      `<path d="M180 156 C216 137 213 94 172 99 C148 102 141 130 153 153 Z" fill="#e8f6ff"/>` +
      `<ellipse cx="126" cy="190" rx="58" ry="59" fill="#c5ddff"/>` +
      `<path d="M78 195 C87 225 105 239 126 239 C147 239 165 225 174 195 C154 205 142 210 126 210 C110 210 98 205 78 195 Z" fill="#f8fbff"/>` +
      `<circle cx="126" cy="113" r="63" fill="#ffd0a8"/>` +
      `<path d="M70 98 C81 58 112 42 143 50 C168 57 184 78 188 105 C172 92 154 85 134 85 C111 85 91 90 70 98 Z" fill="#f0a94c"/>` +
      `<path d="M76 110 C93 95 117 92 139 96 C159 99 174 108 185 121 C181 82 150 55 112 63 C88 68 74 82 76 110 Z" fill="#f0a94c"/>` +
      `<path d="M126 126 L116 136 L138 136 Z" fill="#d97976" stroke-width="4"/>` +
      `<path d="M126 138 C121 147 111 147 106 139 M126 138 C131 147 141 147 146 139" fill="none" stroke-width="4"/>` +
      `</g>` +
      `${eye(101, 115, 8, 11)}${eye(151, 115, 8, 11)}${cheek(84, 142, 10, 5, "#ff93a1")}${cheek(168, 142, 10, 5, "#ff93a1")}`,
  ),
  sticker(
    "cr-baby-unicorn",
    "아기 유니콘",
    260,
    280,
    `${shadow(130, 255, 75, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M70 180 C40 160 45 130 65 140 C55 125 70 120 85 130 C75 115 95 110 105 130" fill="#fbcfe8" />` +
      `<path d="M190 180 C220 160 215 130 195 140 C205 125 190 120 175 130 C185 115 165 110 155 130" fill="#fbcfe8" />` +
      `<ellipse cx="130" cy="195" rx="55" ry="50" fill="${WHITE}" />` +
      `<ellipse cx="130" cy="195" rx="35" ry="30" fill="#fdf2f8" />` +
      `<circle cx="130" cy="120" r="58" fill="${WHITE}" />` +
      `<path d="M80 82 L55 50 L88 72 Z" fill="${WHITE}" />` +
      `<path d="M80 78 L65 56 L83 72 Z" fill="#fbcfe8" stroke-width="4" />` +
      `<path d="M180 82 L205 50 L172 72 Z" fill="${WHITE}" />` +
      `<path d="M180 78 L195 56 L177 72 Z" fill="#fbcfe8" stroke-width="4" />` +
      `<path d="M90 85 Q110 65 130 82 T170 85" fill="none" stroke="#fbcfe8" stroke-width="15" />` +
      `<path d="M100 80 Q120 60 140 77 T160 80" fill="none" stroke="#ddd6fe" stroke-width="12" />` +
      `<polygon points="130,22 138,62 122,62" fill="#fde047" />` +
      `<line x1="125" y1="50" x2="135" y2="40" stroke-width="4" />` +
      `<line x1="124" y1="36" x2="134" y2="28" stroke-width="4" />` +
      `<ellipse cx="130" cy="142" rx="24" ry="16" fill="#fce7f3" />` +
      `<circle cx="123" cy="138" r="3" fill="${INK}" stroke="none" />` +
      `<circle cx="137" cy="138" r="3" fill="${INK}" stroke="none" />` +
      `<path d="M125 146 Q130 152 135 146" fill="none" stroke-width="4" />` +
      `</g>` +
      `${eye(104, 118, 9, 12)}${eye(156, 118, 9, 12)}${cheek(86, 138)}${cheek(174, 138)}`,
  ),
  sticker(
    "cr-baby-phoenix",
    "아기 피닉스",
    260,
    260,
    `${shadow(130, 235, 70, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M110 220 L90 250 L115 240 L130 255 L145 240 L170 250 L150 220 Z" fill="#ef4444" />` +
      `<path d="M65 160 C50 140 40 170 55 190 Z" fill="#f97316" />` +
      `<path d="M195 160 C210 140 220 170 205 190 Z" fill="#f97316" />` +
      `<circle cx="130" cy="175" r="50" fill="#f97316" />` +
      `<ellipse cx="130" cy="185" rx="32" ry="26" fill="#facc15" />` +
      `<circle cx="130" cy="115" r="54" fill="#f97316" />` +
      `<path d="M130 65 C120 40 140 30 135 15 C150 30 140 50 145 65 Z" fill="#ef4444" />` +
      `<path d="M120 68 C115 50 130 45 125 35 C135 45 128 60 132 68 Z" fill="#facc15" />` +
      `<polygon points="130,122 138,112 122,112" fill="#fbbf24" />` +
      `</g>` +
      `${eye(104, 110, 8, 12)}${eye(156, 110, 8, 12)}${cheek(88, 130, 9, 5, "#ef4444")}${cheek(172, 130, 9, 5, "#ef4444")}`,
  ),
  sticker(
    "cr-shiba-inu",
    "시바견",
    260,
    260,
    `${shadow(130, 225, 75, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<ellipse cx="130" cy="175" rx="55" ry="46" fill="#e28743" />` +
      `<path d="M90 155 L130 185 L170 155 Z" fill="#10b981" />` +
      `<circle cx="130" cy="175" r="5" fill="${WHITE}" stroke="none" />` +
      `<circle cx="130" cy="115" r="56" fill="#e28743" />` +
      `<path d="M78 125 C78 145 105 160 130 160 C155 160 182 145 182 125 C182 110 78 110 78 125 Z" fill="${WHITE}" />` +
      `<path d="M175 70 L200 40 L165 55 Z" fill="#e28743" />` +
      `<path d="M85 70 L60 40 L95 55 Z" fill="#e28743" />` +
      `<path d="M83 66 L68 46 L90 56 Z" fill="#fbcfe8" stroke-width="4" />` +
      `<path d="M177 66 L192 46 L170 56 Z" fill="#fbcfe8" stroke-width="4" />` +
      `<ellipse cx="130" cy="134" rx="18" ry="13" fill="${WHITE}" />` +
      `<ellipse cx="130" cy="128" rx="7" ry="5" fill="${INK}" />` +
      `<path d="M130 133 C126 137 122 137 122 134 M130 133 C134 137 138 137 138 134" fill="none" stroke-width="4" />` +
      `</g>` +
      `${eye(102, 108, 8, 11)}${eye(158, 108, 8, 11)}${cheek(84, 126, 11, 6, "#ff8b6f")}${cheek(176, 126, 11, 6, "#ff8b6f")}`,
  ),
  sticker(
    "cr-alpaca",
    "포근 알파카",
    250,
    280,
    `${shadow(125, 255, 70, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M80 180 C60 180 60 230 80 240 C100 250 150 250 170 240 C190 230 190 180 170 180 Z" fill="#fafaf9" />` +
      `<path d="M100 120 L100 200 H150 L150 120 Z" fill="#fafaf9" />` +
      `<path d="M90 130 A15 15 0 0 0 90 160 A15 15 0 0 0 90 190" fill="none" stroke-width="6" />` +
      `<path d="M160 130 A15 15 0 0 1 160 160 A15 15 0 0 1 160 190" fill="none" stroke-width="6" />` +
      `<rect x="95" y="180" width="60" height="15" rx="5" fill="#ef4444" />` +
      `<rect x="135" y="195" width="15" height="28" rx="2" fill="#ef4444" />` +
      `<line x1="140" y1="223" x2="140" y2="225" stroke="#facc15" stroke-width="4" />` +
      `<line x1="145" y1="223" x2="145" y2="225" stroke="#facc15" stroke-width="4" />` +
      `<path d="M90 90 C80 90 80 60 100 50 C120 40 130 40 150 50 C170 60 170 90 160 90 Z" fill="#fafaf9" />` +
      `<circle cx="105" cy="55" r="14" fill="#fafaf9" />` +
      `<circle cx="125" cy="48" r="15" fill="#fafaf9" />` +
      `<circle cx="145" cy="55" r="14" fill="#fafaf9" />` +
      `<path d="M95 50 L85 20 L100 40 Z" fill="#fafaf9" />` +
      `<path d="M155 50 L165 20 L150 40 Z" fill="#fafaf9" />` +
      `<ellipse cx="125" cy="98" rx="25" ry="20" fill="#fef3c7" />` +
      `<polygon points="125,98 129,92 121,92" fill="${INK}" />` +
      `<path d="M125 101 C122 104 119 104 119 102 M125 101 C128 104 131 104 131 102" fill="none" stroke-width="4" />` +
      `</g>` +
      `${eye(112, 85, 7, 10)}${eye(138, 85, 7, 10)}${cheek(98, 102, 7, 4)}${cheek(152, 102, 7, 4)}`,
  ),
  sticker(
    "cr-baby-seal",
    "아기 하프물범",
    260,
    240,
    `${shadow(130, 215, 85, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M60 170 C30 180 20 200 40 210 Z" fill="#fafaf9" />` +
      `<path d="M200 170 C230 180 240 200 220 210 Z" fill="#fafaf9" />` +
      `<ellipse cx="130" cy="150" rx="80" ry="62" fill="#fafaf9" />` +
      `<ellipse cx="130" cy="156" rx="16" ry="12" fill="#f5f5f4" />` +
      `<ellipse cx="130" cy="150" rx="7" ry="5" fill="${INK}" />` +
      `<path d="M130 155 C126 159 122 159 122 156 M130 155 C134 159 138 159 138 156" fill="none" stroke-width="4" />` +
      `<path d="M105 152 H90 M105 160 L92 165 M155 152 H170 M155 160 L168 165" fill="none" stroke-width="3" />` +
      `</g>` +
      `${eye(104, 134, 9, 12)}${eye(156, 134, 9, 12)}${cheek(84, 154, 11, 6)}${cheek(176, 154, 11, 6)}`,
  ),
  sticker(
    "cr-raccoon-ninja",
    "닌자 너구리",
    260,
    260,
    `${shadow(130, 230, 75, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="130" cy="175" r="50" fill="#94a3b8" />` +
      `<ellipse cx="130" cy="185" rx="30" ry="24" fill="#cbd5e1" />` +
      `<path d="M90 158 L130 178 L170 158" stroke="#3b82f6" stroke-width="12" stroke-linecap="round" fill="none" />` +
      `<circle cx="130" cy="115" r="54" fill="#94a3b8" />` +
      `<ellipse cx="98" cy="122" rx="20" ry="15" fill="#334155" transform="rotate(-15 98 122)" />` +
      `<ellipse cx="162" cy="122" rx="20" ry="15" fill="#334155" transform="rotate(15 162 122)" />` +
      `<ellipse cx="130" cy="132" rx="14" ry="10" fill="#f8fafc" />` +
      `<polygon points="130,130 134,125 126,125" fill="${INK}" />` +
      `<path d="M78 95 H182" stroke="#3b82f6" stroke-width="14" stroke-linecap="round" />` +
      `<rect x="115" y="90" width="30" height="10" rx="2" fill="#cbd5e1" stroke="none" />` +
      `<circle cx="130" cy="95" r="2" fill="${INK}" stroke="none" />` +
      `<path d="M85 70 L65 44 L95 56 Z" fill="#475569" />` +
      `<path d="M175 70 L195 44 L165 56 Z" fill="#475569" />` +
      `</g>` +
      `${eye(102, 120, 8, 11)}${eye(158, 120, 8, 11)}${cheek(84, 138, 9, 5, "#ff8b8b")}${cheek(176, 138, 9, 5, "#ff8b8b")}`,
  ),
  sticker(
    "cr-sloth",
    "늘보 늘보",
    260,
    260,
    `${shadow(130, 230, 75, 13)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<circle cx="130" cy="175" r="50" fill="#d97706" />` +
      `<ellipse cx="130" cy="185" rx="30" ry="24" fill="#fef3c7" />` +
      `<circle cx="130" cy="115" r="54" fill="#d97706" />` +
      `<ellipse cx="130" cy="118" rx="42" ry="34" fill="#fef3c7" />` +
      `<path d="M82 120 C82 105 105 110 105 125 C105 135 82 135 82 120 Z" fill="#b45309" />` +
      `<path d="M178 120 C178 105 155 110 155 125 C155 135 178 135 178 120 Z" fill="#b45309" />` +
      `<ellipse cx="130" cy="126" rx="9" ry="6" fill="#78350f" />` +
      `<path d="M124 136 Q130 140 136 136" fill="none" stroke-width="4" />` +
      `</g>` +
      `${eye(96, 120, 6, 9)}${eye(164, 120, 6, 9)}${cheek(84, 134, 8, 4, "#ff9aa1")}${cheek(176, 134, 8, 4, "#ff9aa1")}`,
  ),
  sticker(
    "cr-baby-griffin",
    "아기 그리핀",
    260,
    280,
    `${shadow(130, 250, 75, 14)}` +
      `<g stroke="${INK}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">` +
      `<path d="M70 170 C45 150 40 110 65 120 C55 100 80 95 95 115" fill="#facc15" />` +
      `<path d="M190 170 C215 150 220 110 195 120 C205 100 180 95 165 115" fill="#facc15" />` +
      `<ellipse cx="130" cy="190" rx="55" ry="46" fill="#eab308" />` +
      `<path d="M130 236 Q150 250 175 240" fill="none" stroke-width="7" />` +
      `<circle cx="180" cy="235" r="8" fill="#fbbf24" />` +
      `<circle cx="130" cy="115" r="54" fill="#fbbf24" />` +
      `<path d="M110 65 L95 45 L115 55 Z" fill="#fbbf24" />` +
      `<path d="M150 65 L165 45 L145 55 Z" fill="#fbbf24" />` +
      `<polygon points="130,140 142,120 118,120" fill="#f59e0b" />` +
      `<polygon points="130,140 136,120 124,120" fill="#d97706" />` +
      `</g>` +
      `${eye(104, 108, 9, 12)}${eye(156, 108, 9, 12)}${cheek(86, 130, 9, 5)}${cheek(174, 130, 9, 5)}`,
  ),
];
