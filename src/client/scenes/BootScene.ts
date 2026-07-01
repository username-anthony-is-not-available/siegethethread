import { Scene } from 'phaser';
import * as Phaser from 'phaser';

export class BootScene extends Scene {
  constructor() {
    super('BootScene');
  }

  preload(): void {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 12;
    const ctx = canvas.getContext('2d')!;
    const chars = '0123456789';
    const charWidth = 10;
    ctx.font = 'bold 10px monospace';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.textAlign = 'center';

    const config: Phaser.Types.GameObjects.BitmapText.RetroFontConfig = {
      image: 'swarm_font',
      width: 10,
      height: 12,
      chars: chars,
      charsPerRow: 10,
      spacing: { x: 0, y: 0 },
      lineSpacing: 0,
      offset: { x: 0, y: 0 }
    } as any;

    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i]!, i * charWidth + (charWidth/2), 7);
    }
    this.textures.addCanvas('swarm_font', canvas);
    this.cache.bitmapFont.add('swarm_font', Phaser.GameObjects.RetroFont.Parse(this, config));

    graphics.fillStyle(0x00f0ff, 1);
    graphics.fillCircle(12, 12, 10);
    graphics.lineStyle(1.5, 0xffffff, 1);
    graphics.strokeCircle(12, 12, 10);
    graphics.generateTexture('swarm_fallback', 24, 24);
    graphics.clear();

    graphics.fillStyle(0xff7700, 1);
    graphics.fillCircle(4, 4, 3);
    graphics.generateTexture('particle_dot', 8, 8);
    graphics.clear();

    graphics.fillStyle(0x00f0ff, 1);
    graphics.fillCircle(4, 4, 3);
    graphics.generateTexture('particle_blue', 8, 8);
    graphics.clear();

    graphics.fillStyle(0xffd166, 1);
    graphics.fillRect(2, 2, 28, 28);
    graphics.lineStyle(2, 0x111622, 1);
    graphics.strokeRect(2, 2, 28, 28);
    graphics.fillStyle(0x111622, 1);
    graphics.fillRect(12, 12, 8, 12);
    graphics.generateTexture('vault_fallback', 32, 32);
    graphics.clear();

    graphics.lineStyle(2, 0xef233c, 1);
    graphics.strokeLineShape(new Phaser.Geom.Line(4, 4, 28, 28));
    graphics.strokeLineShape(new Phaser.Geom.Line(4, 28, 28, 4));
    graphics.fillStyle(0xef233c, 0.4);
    graphics.fillRect(4, 4, 24, 24);
    graphics.generateTexture('trap_fallback', 32, 32);
    graphics.clear();

    graphics.fillStyle(0x8d99ae, 1);
    graphics.fillRect(4, 0, 24, 32);
    graphics.fillStyle(0xd90429, 1);
    graphics.fillRect(8, 4, 16, 10);
    graphics.generateTexture('tower_fallback', 32, 32);
    graphics.clear();

    graphics.fillStyle(0xffd166, 1);
    graphics.fillCircle(3, 3, 3);
    graphics.generateTexture('projectile_fallback', 6, 6);
    graphics.clear();
  }

  create(): void {
    this.scene.start('OnboardingScene');
  }
}
