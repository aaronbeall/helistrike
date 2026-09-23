import "./style.css";
import Phaser from "phaser";
import { BootScene } from "./scenes/bootScene";
import { LoadScene } from "./scenes/loadScene";
import { MenuScene } from "./scenes/menuScene";
import { MissionScene } from "./scenes/missionScene";
import { RigsScene } from "./rigs/rigs";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#1a1610",
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  physics: { default: "arcade" },
  scene: [BootScene, RigsScene, MenuScene, LoadScene, MissionScene],
  render: { antialias: true, pixelArt: false },
};

new Phaser.Game(config);
