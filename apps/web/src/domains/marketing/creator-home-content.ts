export const CREATOR_FILM = {
  src: "/brand/toonstudio-intro.mp4",
  poster: "/brand/toonstudio-film-poster.jpg",
  captions: "/brand/toonstudio-intro.ko.vtt",
  duration: 24,
  chapters: [0, 6, 12, 18],
} as const;

export const CREATOR_DESTINATIONS = ["/studio", "/studio/comic", "/shaper", "/market", "/create", "/ranking", "/explore"] as const;

export const HOME_COPY = {
  ko: {
    eyebrow: "YOUR STORY STARTS HERE",
    title: ["아이디어를", "첫 장면으로."],
    description: "그리는 순간부터 이야기가 되는 순간까지. 드로잉, 컷과 말풍선, 3D 장면을 하나의 창작 공간에서 만나보세요.",
    start: "스튜디오 시작하기", watch: "24초로 만나보기", note: "별도 앱 설치 없이, 브라우저에서 시작하세요.",
    preview: "나의 첫 번째 이야기", previewNote: "제작 흐름을 재구성한 소개 화면", tools: "창작 과정 미리보기", example: "이야기의 시작", layer: "레이어", scene: "장면", saved: "CREATIVE WORKSPACE",
    strip: ["드로잉과 브러시", "컷과 말풍선", "3D 장면 구성", "템플릿과 에셋"],
    processEyebrow: "FROM A SPARK TO A STORY", processTitle: "당신의 이야기에,\n필요한 도구를 더하다.",
    processBody: "빈 캔버스 앞의 막막함은 줄이고, 표현하는 즐거움은 더하세요. 필요한 도구부터 시작해 나만의 작업 흐름을 만들어보세요.",
    stages: [
      { id: "draw", label: "01  그리고", title: "첫 번째 선에서 시작하세요.", body: "브러시와 레이어로 아이디어를 스케치하고, 색과 질감을 더해 나만의 장면을 만드세요.", href: "/studio", action: "드로잉 시작하기" },
      { id: "comic", label: "02  이야기로 엮고", title: "장면과 장면 사이에 이야기를.", body: "컷을 나누고 말풍선을 배치해 보세요. 대사와 장면의 흐름을 한 화면에서 다듬을 수 있습니다.", href: "/studio/comic", action: "컷툰 만들기" },
      { id: "scene", label: "03  공간을 더하세요", title: "상상 속 장면에 깊이를 더하세요.", body: "3D 캐릭터와 배경 도구를 활용해 구도와 공간을 탐색하고, 이야기에 어울리는 장면을 구상하세요.", href: "/shaper", action: "캐릭터 도구 살펴보기" },
    ],
    toolkitEyebrow: "A PLACE FOR EVERY IDEA", toolkitTitle: "만들고 싶은 만큼,\n다양한 시작점.",
    features: [
      { tag: "DRAW", title: "자유롭게 그리기", body: "브러시, 레이어, 필터로 장면의 표정을 만드세요.", href: "/studio", action: "캔버스 열기" },
      { tag: "TELL", title: "컷으로 이야기하기", body: "컷과 말풍선으로 짧은 아이디어를 하나의 이야기로.", href: "/studio/comic", action: "컷툰 시작하기" },
      { tag: "BUILD", title: "입체적으로 구상하기", body: "캐릭터와 장면 도구로 포즈와 구도를 탐색하세요.", href: "/shaper", action: "3D 도구 보기" },
      { tag: "COLLECT", title: "재료에서 영감 얻기", body: "창작에 활용할 리소스를 살펴보고 작업의 출발점을 찾으세요.", href: "/market", action: "에셋 마켓 둘러보기" },
    ],
    filmEyebrow: "MEET TOONSTUDIO", filmTitle: "상상이 작품이 되는 곳.\n툰스튜디오를 만나보세요.",
    filmBody: "선 하나에서 시작해 장면을 그리고 이야기를 엮는 과정. 24초의 브랜드 필름으로 새로운 창작 공간을 소개합니다.",
    filmPlay: "24초 소개 영상 재생", filmLabel: "툰스튜디오 브랜드 소개 영상", filmReset: "포스터로 돌아가기", filmError: "영상을 불러오지 못했습니다. 다시 재생하거나 스튜디오에서 직접 살펴보세요.", retry: "다시 재생", transcript: "영상 내용 읽기", transcriptBody: "0–6초: 아이디어를 첫 장면으로. 6–12초: 브러시와 레이어로 그리고 표현하기. 12–18초: 컷과 말풍선, 3D 도구로 장면 구성하기. 18–24초: 당신의 다음 이야기는 툰스튜디오에서 시작됩니다. 이 영상은 제작 흐름을 시각화한 무음 브랜드 필름입니다.",
    chapterLabels: ["아이디어의 시작", "그리는 즐거움", "이야기와 공간", "지금 시작하기"],
    inspirationEyebrow: "CREATE. SHARE. DISCOVER.", inspirationTitle: "창작 다음의 즐거움도, 함께.",
    galleryTitle: "다른 창작자의 이야기를 만나세요", galleryBody: "창작 갤러리에서 다양한 표현과 이야기를 살펴보세요.", galleryAction: "창작 갤러리 보기",
    exploreTitle: "좋아하는 작품에서 영감을 얻으세요", exploreBody: "기존 웹툰·웹소설 탐색과 랭킹도 그대로 이용할 수 있습니다.", exploreAction: "작품 탐색", ranking: "랭킹 보기",
    faqTitle: "시작하기 전에 궁금한 것들", faqs: [
      { q: "기존 랭킹과 작품 검색은 어디에 있나요?", a: "랭킹과 작품 탐색은 계속 제공됩니다. 이 페이지의 작품 탐색·랭킹 링크와 전체 메뉴에서 기존 기능으로 이동할 수 있습니다." },
      { q: "어디서부터 시작하면 좋을까요?", a: "자유롭게 그리려면 스튜디오, 컷과 대사를 구성하려면 컷툰, 캐릭터와 구도를 살펴보려면 3D 도구에서 시작하세요." },
      { q: "소개 영상에 나오는 화면은 실제 작품인가요?", a: "소개 화면과 영상은 창작 과정을 설명하기 위해 제작한 예시입니다. 커뮤니티 이용자의 작품이나 실제 작업 결과로 표시하지 않습니다." },
      { q: "모바일에서도 이용할 수 있나요?", a: "모바일 브라우저에서도 접속할 수 있습니다. 정밀한 드로잉이나 복잡한 3D 작업은 화면 크기와 기기 성능에 따라 이용 경험이 달라질 수 있습니다." },
    ],
    closingEyebrow: "MAKE ROOM FOR YOUR IMAGINATION", closingTitle: "다음 이야기는,\n당신의 손끝에서.", closingNote: "작은 스케치 하나로 시작해도 좋아요.",
  },
  en: {
    eyebrow: "YOUR STORY STARTS HERE", title: ["An idea today.", "Your first scene."],
    description: "From the first stroke to a story of your own. Explore drawing, comic panels, speech bubbles and 3D scenes in one creative space.",
    start: "Open ToonStudio", watch: "Watch the 24-second film", note: "Start in your browser. No separate app to install.",
    preview: "My first story", previewNote: "Illustrated example of the creative workflow", tools: "Preview a creative workflow", example: "A story begins", layer: "Layers", scene: "Scene", saved: "CREATIVE WORKSPACE",
    strip: ["Drawing & brushes", "Panels & dialogue", "3D scene tools", "Templates & assets"],
    processEyebrow: "FROM A SPARK TO A STORY", processTitle: "Your story.\nYour creative toolkit.", processBody: "Spend less time facing a blank canvas and more time expressing an idea. Start with the tools you need and build your own workflow.",
    stages: [
      { id: "draw", label: "01  Draw", title: "Begin with a single stroke.", body: "Sketch an idea with brushes and layers, then add color and texture to bring your scene to life.", href: "/studio", action: "Start drawing" },
      { id: "comic", label: "02  Tell a story", title: "Let one scene lead to the next.", body: "Arrange panels and speech bubbles. Shape the flow of dialogue and scenes in your comic workspace.", href: "/studio/comic", action: "Create a comic" },
      { id: "scene", label: "03  Add dimension", title: "Give your ideas a sense of space.", body: "Explore composition with 3D character and scene tools, and plan a setting that fits your story.", href: "/shaper", action: "Explore character tools" },
    ],
    toolkitEyebrow: "A PLACE FOR EVERY IDEA", toolkitTitle: "More ways\nto begin creating.",
    features: [
      { tag: "DRAW", title: "Draw your way", body: "Express a scene with brushes, layers and filters.", href: "/studio", action: "Open the canvas" },
      { tag: "TELL", title: "Build a comic", body: "Turn a small idea into a story with panels and dialogue.", href: "/studio/comic", action: "Start a comic" },
      { tag: "BUILD", title: "Think in 3D", body: "Explore poses and composition with character and scene tools.", href: "/shaper", action: "Explore 3D tools" },
      { tag: "COLLECT", title: "Find your materials", body: "Browse creative resources and find a starting point for your next work.", href: "/market", action: "Explore the asset market" },
    ],
    filmEyebrow: "MEET TOONSTUDIO", filmTitle: "A space for imagination.\nMeet ToonStudio.", filmBody: "A line becomes a scene. Scenes become a story. Discover your creative workspace in our 24-second brand film.",
    filmPlay: "Play the 24-second introduction", filmLabel: "ToonStudio brand introduction", filmReset: "Back to poster", filmError: "The video could not load. Try again or explore the studio directly.", retry: "Try again", transcript: "Read the video transcript", transcriptBody: "0–6 seconds: From an idea to your first scene. 6–12: Express yourself with brushes and layers. 12–18: Arrange panels, dialogue and 3D scenes. 18–24: Your next story starts in ToonStudio. This silent brand film illustrates a creative workflow.",
    chapterLabels: ["An idea begins", "The joy of drawing", "Stories and spaces", "Start creating"],
    inspirationEyebrow: "CREATE. SHARE. DISCOVER.", inspirationTitle: "Keep the inspiration going.", galleryTitle: "Discover other creators", galleryBody: "Explore different voices and expressions in the creator gallery.", galleryAction: "Visit the creator gallery", exploreTitle: "Find inspiration in stories you love", exploreBody: "Webtoon and web novel discovery, search and rankings are still here.", exploreAction: "Explore stories", ranking: "View rankings",
    faqTitle: "Before your first scene", faqs: [
      { q: "Where are the existing rankings and search?", a: "They are still available. Use the Explore and Rankings links on this page or open the full navigation menu." },
      { q: "Where should I start?", a: "Use the studio for free drawing, the comic workspace for panels and dialogue, or the 3D tools to explore characters and composition." },
      { q: "Is the work in the introduction a real user project?", a: "The visuals and film are illustrative examples created to explain a workflow. They are not presented as user artwork or actual project results." },
      { q: "Can I use a mobile device?", a: "You can visit in a mobile browser. Precise drawing and complex 3D work may feel different depending on screen size and device performance." },
    ],
    closingEyebrow: "MAKE ROOM FOR YOUR IMAGINATION", closingTitle: "Your next story.\nAt your fingertips.", closingNote: "A small sketch is a wonderful place to start.",
  },
} as const;

export type CreatorHomeCopy = (typeof HOME_COPY)[keyof typeof HOME_COPY];
export function creatorHomeLocale(locale: string): keyof typeof HOME_COPY {
  return locale.toLowerCase().split(/[-_]/)[0] === "ko" ? "ko" : "en";
}
