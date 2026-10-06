import Phaser from "phaser";
import { formatDuration } from "../../../util/format";
import { type MissionScene } from "../../missionScene";

/** Top-center run tally: kills, collateral, flight time (subtle info text). */
export class RunStatsHud {
  txt!: Phaser.GameObjects.Text;
  private kills = -1;
  private collateral = -1;
  private seconds = -1;

  constructor(readonly s: MissionScene) {}

  reset(): void {
    this.kills = this.collateral = this.seconds = -1;
  }

  sync(): void {
    const st = this.s.stats;
    const sec = Math.floor(st.timeFlown);
    if (st.kills === this.kills && st.collateral === this.collateral && sec === this.seconds) return;
    this.kills = st.kills;
    this.collateral = st.collateral;
    this.seconds = sec;
    this.txt.setText(`KILLS ${st.kills}   COLLATERAL ${st.collateral}   FLIGHT ${formatDuration(sec)}`);
  }
}
