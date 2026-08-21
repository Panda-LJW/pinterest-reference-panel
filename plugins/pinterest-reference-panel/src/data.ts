export type MockPin = {
  id: string;
  boardId: string;
  title: string;
  note: string;
  aspect: number;
  art: "dino" | "ember" | "portrait" | "poster" | "flora" | "orbit" | "ink" | "pool";
  palette: [string, string, string];
};

export type MockBoard = {
  id: string;
  title: string;
  description: string;
};

export const boards: MockBoard[] = [
  { id: "characters", title: "角色与姿态", description: "人物轮廓、动作和服装参考" },
  { id: "editorial", title: "编辑设计", description: "杂志封面、字体和版式节奏" },
  { id: "color", title: "色彩与光", description: "大胆配色与电影感照明" },
  { id: "creatures", title: "怪兽涂鸦", description: "玩具感生物和粗粝笔触" }
];

export const pins: MockPin[] = [
  {
    id: "pin-dino-blue",
    boardId: "creatures",
    title: "蓝色暴龙涂鸦",
    note: "粗线条、玩具感比例、明亮底色",
    aspect: 0.74,
    art: "dino",
    palette: ["#0B9BCE", "#F5D547", "#111111"]
  },
  {
    id: "pin-ember-friend",
    boardId: "color",
    title: "火焰伙伴",
    note: "深色空间里的暖色发光角色",
    aspect: 0.82,
    art: "ember",
    palette: ["#0B0606", "#F45D22", "#FFB320"]
  },
  {
    id: "pin-neon-portrait",
    boardId: "characters",
    title: "霓虹角色肖像",
    note: "酸性绿与紫色的角色配色",
    aspect: 0.78,
    art: "portrait",
    palette: ["#FF7A3D", "#B9FF30", "#9C5BFF"]
  },
  {
    id: "pin-red-dress",
    boardId: "characters",
    title: "红色礼服背影",
    note: "低调黑场与红色轮廓光",
    aspect: 0.66,
    art: "ink",
    palette: ["#080606", "#7A0B19", "#E72C3B"]
  },
  {
    id: "pin-pool-editorial",
    boardId: "editorial",
    title: "泳池编辑封面",
    note: "水光、留白与窄体标题",
    aspect: 0.72,
    art: "pool",
    palette: ["#80DAE8", "#F76D8C", "#F5EEE7"]
  },
  {
    id: "pin-flora-study",
    boardId: "color",
    title: "热带植物色稿",
    note: "珊瑚红、叶绿与纸张颗粒",
    aspect: 0.9,
    art: "flora",
    palette: ["#F6634D", "#155F47", "#F5D9A7"]
  },
  {
    id: "pin-orbit-type",
    boardId: "editorial",
    title: "轨道字体实验",
    note: "黑白结构与单点亮红",
    aspect: 0.68,
    art: "orbit",
    palette: ["#EEECE7", "#171717", "#E60023"]
  },
  {
    id: "pin-signal-poster",
    boardId: "editorial",
    title: "信号海报",
    note: "扫描线、暖棕色与叠印人影",
    aspect: 0.75,
    art: "poster",
    palette: ["#6D2C16", "#E9A64C", "#25130E"]
  }
];

export function getMockPanelData() {
  return {
    mode: "demo" as const,
    refreshedAt: new Date().toISOString(),
    boards: boards.map((board) => ({
      ...board,
      pinCount: pins.filter((pin) => pin.boardId === board.id).length
    })),
    pins
  };
}
