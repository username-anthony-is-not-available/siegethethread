import { GameObjects, Scene } from 'phaser';
import * as Phaser from 'phaser';
import { THEME } from '../theme';
import { GRID_SIZE, TILE_TOWER, TILE_TRAP, type Grid } from '../../shared/grid';

const TILE_SIZE = 32;

export class CinematicScene extends Scene {
  private grid: Grid = [];
  private originX = 0;
  private originY = 0;

  private replayData: {
    victory: 'Attacker' | 'Defender';
    frames: Array<{
      tick: number;
      swarms: Array<{ x: number; y: number; count: number }>;
    }>;
  } | null = null;
  private replayFrameIndex = 0;
  private REPLAY_TICK_DURATION = 800; // ms
  private replayAccumulator = 0;
  private replayPlaying = false;

  private activeSwarmNodes: Array<{
    sprite: { container: GameObjects.Container; text: GameObjects.BitmapText; bg: GameObjects.Sprite };
    targetX: number;
    targetY: number;
    isFadingOut: boolean;
  }> = [];

  private pool: Array<{ container: GameObjects.Container; text: GameObjects.BitmapText; bg: GameObjects.Sprite }> = [];
  private towerSprites: GameObjects.Sprite[] = [];
  private trapCoords: Array<{ x: number; y: number }> = [];
  private pathOverlayGraphics: GameObjects.Graphics | null = null;

  constructor() {
    super('CinematicScene');
  }

  create(data: { grid: Grid; originX: number; originY: number; replayData: any }): void {
    this.grid = data.grid || [];
    this.originX = data.originX || 0;
    this.originY = data.originY || 0;

    if (data.replayData) {
      this.playCinematicReplay(data.replayData);
    }
  }

  private getNodeSprite(): { container: GameObjects.Container; text: GameObjects.BitmapText; bg: GameObjects.Sprite } {
    if (this.pool.length > 0) {
      const node = this.pool.pop()!;
      node.container.setVisible(true).setAlpha(1);
      return node;
    }
    const container = this.add.container(0, 0).setDepth(THEME.Z_INDEX.UI);
    const bg = this.add.sprite(0, 0, 'swarm_fallback');
    const text = this.add.bitmapText(0, 0, 'swarm_font', '0').setOrigin(0.5);
    container.add([bg, text]);
    return { container, text, bg };
  }

  private releaseNodeSprite(node: { container: GameObjects.Container; text: GameObjects.BitmapText; bg: GameObjects.Sprite }): void {
    node.container.setVisible(false);
    this.pool.push(node);
  }

  private playCinematicReplay(replayData: {
    victory: 'Attacker' | 'Defender';
    frames: Array<{
      tick: number;
      swarms: Array<{ x: number; y: number; count: number }>;
    }>;
  }): void {
    this.clearSwarmAnimation();

    const graphics = this.add.graphics().setDepth(THEME.Z_INDEX.OVERLAY_GRAPHICS);
    this.pathOverlayGraphics = graphics;

    this.trapCoords = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (this.grid[r]?.[c] === TILE_TOWER) {
          const px = this.originX + c * TILE_SIZE + TILE_SIZE / 2;
          const py = this.originY + r * TILE_SIZE + TILE_SIZE / 2;
          const ts = this.add.sprite(px, py, 'tower_fallback').setDepth(THEME.Z_INDEX.TOWER);
          this.towerSprites.push(ts);
        } else if (this.grid[r]?.[c] === TILE_TRAP) {
          this.trapCoords.push({ x: c, y: r });
          const px = this.originX + c * TILE_SIZE + TILE_SIZE / 2;
          const py = this.originY + r * TILE_SIZE + TILE_SIZE / 2;
          this.add.sprite(px, py, 'trap_fallback').setDepth(THEME.Z_INDEX.TRAP).setAlpha(0.6);
        }
      }
    }

    this.replayData = replayData;
    this.replayFrameIndex = 0;
    this.replayAccumulator = 0;
    this.replayPlaying = true;

    this.advanceReplayFrame();
  }

  private advanceReplayFrame(): void {
    if (!this.replayData || !this.replayPlaying) return;

    const currentFrame = this.replayData.frames[this.replayFrameIndex];
    if (!currentFrame) {
      this.time.delayedCall(1500, () => {
        this.replayPlaying = false;
        if (this.replayData) {
          this.showRewardModal(this.replayData.victory);
        }
      });
      return;
    }

    const newActiveNodes: typeof this.activeSwarmNodes = [];

    if (this.pathOverlayGraphics) {
      this.pathOverlayGraphics.clear();
    }

    currentFrame.swarms.forEach((swarm) => {
      const px = this.originX + swarm.x * TILE_SIZE + TILE_SIZE / 2;
      const py = this.originY + swarm.y * TILE_SIZE + TILE_SIZE / 2;

      let targetScale = 1;
      let targetAlpha = 1;

      const previousNodeIdx = this.activeSwarmNodes.findIndex(
        (n) => Math.abs(n.targetX - px) < TILE_SIZE && Math.abs(n.targetY - py) < TILE_SIZE
      );

      let spriteObj: { container: GameObjects.Container; text: GameObjects.BitmapText; bg: GameObjects.Sprite };
      if (previousNodeIdx !== -1) {
        const prev = this.activeSwarmNodes.splice(previousNodeIdx, 1)[0]!;
        spriteObj = prev.sprite;
      } else {
        spriteObj = this.getNodeSprite();
        let startX = px, startY = py;
        let closestDist = Infinity;
        let closestNode = null;
        for (const n of this.activeSwarmNodes) {
          const dist = Phaser.Math.Distance.Between(n.targetX, n.targetY, px, py);
          if (dist < closestDist && dist <= TILE_SIZE * 2) {
             closestDist = dist;
             closestNode = n;
          }
        }
        if (closestNode) {
          startX = closestNode.targetX;
          startY = closestNode.targetY;
        } else {
          spriteObj.container.setScale(0.1);
          spriteObj.container.setAlpha(0.1);
        }
        spriteObj.container.setPosition(startX, startY);
      }

      if (swarm.count <= 0) {
        targetScale = 0;
        targetAlpha = 0;
      }

      spriteObj.text.setText(swarm.count > 0 ? swarm.count.toString() : '');
      const scaleBase = Math.min(1.5, Math.max(0.5, swarm.count / 50));
      targetScale = swarm.count > 0 ? scaleBase : 0;

      spriteObj.bg.setTint(THEME.COLORS.SWARM);

      if (swarm.count > 0) {
        const isTrap = this.trapCoords.some(tc => tc.x === swarm.x && tc.y === swarm.y);
        if (isTrap) {
           spriteObj.bg.setTint(0xff0000);
           this.spawnTrapParticles(px, py);
        }

        this.towerSprites.forEach(tower => {
           const distSq = (tower.x - px)**2 + (tower.y - py)**2;
           if (distSq <= (TILE_SIZE * 4.5)**2) {
              this.fireTowerLaser(tower.x, tower.y, px, py);
           }
        });
      }

      if (swarm.x === 15 && swarm.y === 15 && this.replayData?.victory === 'Attacker') {
         targetScale = 2.5;
         this.cameras.main.shake(300, 0.015);
         const vaultNode = this.children.list.find(c => (c as any).texture?.key === 'vault_fallback') as GameObjects.Sprite;
         if (vaultNode) {
           this.tweens.add({
              targets: vaultNode,
              scale: { from: 1, to: 1.5 },
              yoyo: true,
              duration: 150
           });
         }
      }

      // Native Tween Implementation instead of manual loop interpolation
      this.tweens.add({
        targets: spriteObj.container,
        x: px,
        y: py,
        scaleX: targetScale,
        scaleY: targetScale,
        alpha: targetAlpha,
        duration: this.REPLAY_TICK_DURATION,
        ease: 'Sine.inOut',
        onComplete: () => {
          if (swarm.count <= 0) {
            spriteObj.container.setVisible(false);
          }
        }
      });

      newActiveNodes.push({
        sprite: spriteObj,
        targetX: px,
        targetY: py,
        isFadingOut: swarm.count <= 0
      });
    });

    this.activeSwarmNodes.forEach(node => {
      this.tweens.add({
        targets: node.sprite.container,
        scaleX: 0,
        scaleY: 0,
        alpha: 0,
        duration: this.REPLAY_TICK_DURATION,
        ease: 'Sine.inOut',
        onComplete: () => {
          node.sprite.container.setVisible(false);
        }
      });
      node.isFadingOut = true;
      newActiveNodes.push(node);
    });

    this.activeSwarmNodes = newActiveNodes;
    this.replayFrameIndex++;
  }

  override update(_time: number, delta: number): void {
    if (this.replayPlaying && this.replayData) {
      this.replayAccumulator += delta;
      if (this.replayAccumulator >= this.REPLAY_TICK_DURATION) {
        this.advanceReplayFrame();
        this.replayAccumulator -= this.REPLAY_TICK_DURATION;
      }
    }
  }

  private clearSwarmAnimation(): void {
    this.replayPlaying = false;
    this.activeSwarmNodes.forEach((node) => this.releaseNodeSprite(node.sprite));
    this.activeSwarmNodes = [];
    if (this.pathOverlayGraphics) {
      this.pathOverlayGraphics.clear();
    }
    this.towerSprites.forEach(ts => ts.destroy());
    this.towerSprites = [];
  }

  private spawnTrapParticles(x: number, y: number): void {
    const emitter = this.add.particles(0, 0, 'particle_dot', {
       x, y,
       speed: { min: 50, max: 150 },
       angle: { min: 0, max: 360 },
       scale: { start: 1, end: 0 },
       alpha: { start: 1, end: 0 },
       lifespan: 400,
       quantity: 15,
       blendMode: 'ADD'
    }).setDepth(THEME.Z_INDEX.PARTICLES_BOTTOM);
    this.time.delayedCall(450, () => emitter.destroy());
  }

  private fireTowerLaser(startX: number, startY: number, endX: number, endY: number): void {
    const proj = this.add.sprite(startX, startY, 'projectile_fallback').setDepth(THEME.Z_INDEX.PROJECTILE);
    this.tweens.add({
       targets: proj,
       x: endX,
       y: endY,
       duration: 150,
       onComplete: () => {
          proj.destroy();
          const impact = this.add.particles(0, 0, 'particle_blue', {
             x: endX, y: endY,
             speed: 40,
             scale: { start: 0.8, end: 0 },
             lifespan: 200,
             quantity: 5,
             blendMode: 'ADD'
          }).setDepth(THEME.Z_INDEX.PARTICLES_TOP);
          this.time.delayedCall(250, () => impact.destroy());
       }
    });
  }

  private showRewardModal(victory: 'Attacker' | 'Defender'): void {
    const width = this.scale.width;
    const height = this.scale.height;

    const overlay = this.add.container(0, 0).setDepth(THEME.Z_INDEX.MODAL);

    overlay.add(this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.9));

    const pWidth = 400;
    const pHeight = 280;
    overlay.add(this.add.rectangle(width / 2, height / 2, pWidth, pHeight, 0x161a22).setStrokeStyle(2, 0xffd166));

    const isWin = victory === 'Defender';
    const titleText = isWin ? 'DEFENSE SUCCESS' : 'DEFENSE BREACHED';
    const titleColor = isWin ? '#06d6a0' : '#ef233c';

    overlay.add(this.add.text(width / 2, height / 2 - 90, titleText, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '28px',
      color: titleColor
    }).setOrigin(0.5));

    overlay.add(this.add.text(width / 2 - 100, height / 2 - 20, 'Gold Earned:', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#a0aab2'
    }).setOrigin(0, 0.5));
    overlay.add(this.add.text(width / 2 + 100, height / 2 - 20, isWin ? '+150 🪙' : '+25 🪙', {
      fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '18px', color: '#ffd166'
    }).setOrigin(1, 0.5));

    overlay.add(this.add.text(width / 2 - 100, height / 2 + 20, 'Skill Shards:', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#a0aab2'
    }).setOrigin(0, 0.5));
    overlay.add(this.add.text(width / 2 + 100, height / 2 + 20, isWin ? '+3 💎' : '+0 💎', {
      fontFamily: 'Arial Black, Arial, sans-serif', fontSize: '18px', color: '#00f0ff'
    }).setOrigin(1, 0.5));

    const closeBtn = this.add.rectangle(width / 2, height / 2 + 90, 240, 40, 0x222831)
      .setStrokeStyle(1, 0x4f5d75)
      .setInteractive({ useHandCursor: true });
    const closeTxt = this.add.text(width / 2, height / 2 + 90, 'CLOSE & RETURN', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#ffffff'
    }).setOrigin(0.5);

    closeBtn.on('pointerdown', () => {
      overlay.destroy();
      this.clearSwarmAnimation();

      this.scene.stop('CinematicScene');
      this.scene.wake('GameScene');
    });

    overlay.add([closeBtn, closeTxt]);
  }
}
