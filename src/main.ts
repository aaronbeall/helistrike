import "./style.css";
import Phaser from "phaser";
import { BootScene, LoadScene, MenuScene, MissionScene } from "./scenes";
import { RigsScene } from "./rigs";

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
