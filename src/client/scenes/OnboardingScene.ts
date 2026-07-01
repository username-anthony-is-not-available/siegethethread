import { GameObjects, Scene } from 'phaser';
import { THEME } from '../theme';
import { trpc } from '../trpc';
import type { PlayerClass, PlayerRole } from '../../shared/protocol';


export class OnboardingScene extends Scene {
  private chosenClass: PlayerClass = 'Barbarian';
  private chosenRole: PlayerRole = 'Defender';
  private statusLabel: GameObjects.Text | null = null;

  constructor() {
    super('OnboardingScene');
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.statusLabel = this.add.text(width / 2, 20, '', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 10, y: 5 },
    }).setOrigin(0.5).setDepth(THEME.Z_INDEX.MODAL).setVisible(false);

    this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);

    const modalWidth = 480;
    const modalHeight = 360;
    this.add.rectangle(width / 2, height / 2, modalWidth, modalHeight, 0x161a22)
      .setStrokeStyle(2, 0xffd166);

    this.add.text(width / 2, height / 2 - 140, 'CHARACTER CREATION', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '24px',
      color: '#ffd166',
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2 - 90, 'Choose Your Diablo Class', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#a0aab2',
    }).setOrigin(0.5);

    const classes: PlayerClass[] = ['Barbarian', 'Sorcerer', 'Rogue'];
    const classButtons: GameObjects.Rectangle[] = [];
    const classTexts: GameObjects.Text[] = [];

    classes.forEach((className, idx) => {
      const x = width / 2 - 120 + idx * 120;
      const y = height / 2 - 40;

      const btn = this.add.rectangle(x, y, 100, 50, 0x222831)
        .setStrokeStyle(1, className === this.chosenClass ? 0xffd166 : 0x4f5d75)
        .setInteractive({ useHandCursor: true });

      const txt = this.add.text(x, y, className, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: className === this.chosenClass ? '#ffd166' : '#ffffff',
      }).setOrigin(0.5);

      btn.on('pointerdown', () => {
        this.chosenClass = className;
        classButtons.forEach((b, i) => {
          const isSelected = classes[i] === this.chosenClass;
          b.setStrokeStyle(1, isSelected ? 0xffd166 : 0x4f5d75);
          classTexts[i]?.setStyle({ color: isSelected ? '#ffd166' : '#ffffff' });
        });
      });

      classButtons.push(btn);
      classTexts.push(txt);
    });

    this.add.text(width / 2, height / 2 + 30, 'Choose Daily Operational Role', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#a0aab2',
    }).setOrigin(0.5);

    const roles: PlayerRole[] = ['Attacker', 'Defender'];
    const roleLabels = ['⚔️ Attacker', '🛡️ Defender'];
    const roleButtons: GameObjects.Rectangle[] = [];
    const roleTexts: GameObjects.Text[] = [];

    roles.forEach((roleName, idx) => {
      const x = width / 2 - 80 + idx * 160;
      const y = height / 2 + 75;

      const btn = this.add.rectangle(x, y, 130, 44, 0x222831)
        .setStrokeStyle(1, roleName === this.chosenRole ? 0xffd166 : 0x4f5d75)
        .setInteractive({ useHandCursor: true });

      const txt = this.add.text(x, y, roleLabels[idx] ?? roleName, {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: roleName === this.chosenRole ? '#ffd166' : '#ffffff',
      }).setOrigin(0.5);

      btn.on('pointerdown', () => {
        this.chosenRole = roleName;
        roleButtons.forEach((b, i) => {
          const isSelected = roles[i] === this.chosenRole;
          b.setStrokeStyle(1, isSelected ? 0xffd166 : 0x4f5d75);
          roleTexts[i]?.setStyle({ color: isSelected ? '#ffd166' : '#ffffff' });
        });
      });

      roleButtons.push(btn);
      roleTexts.push(txt);
    });

    const submitBtn = this.add.rectangle(width / 2, height / 2 + 140, 160, 40, 0x06d6a0)
      .setInteractive({ useHandCursor: true });
    this.add.text(width / 2, height / 2 + 140, 'ENTER DUNGEON', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '14px',
      color: '#161a22',
    }).setOrigin(0.5);

    submitBtn.on('pointerover', () => submitBtn.setFillStyle(0x05c493));
    submitBtn.on('pointerout', () => submitBtn.setFillStyle(0x06d6a0));

    submitBtn.on('pointerdown', () => {
      submitBtn.disableInteractive();
      this.showStatus('Saving profile…', 0xffd166);
      trpc.initializeProfile.mutate({
        chosenClass: this.chosenClass,
        chosenRole: this.chosenRole,
      })
      .then((profile) => {
        this.clearStatus();
        this.scene.start('GameScene', { userRole: profile.role, userClass: profile.class });
      })
      .catch((err) => {
        console.error('[OnboardingScene] Failed to initialize profile:', err);
        this.showStatus('Failed to create profile. Try again.', THEME.COLORS.ERROR);
        submitBtn.setInteractive({ useHandCursor: true });
      });
    });
  }

  private showStatus(msg: string, color: number): void {
    if (this.statusLabel) {
      const hexColor = `#${color.toString(16).padStart(6, '0')}`;
      this.statusLabel.setText(msg);
      this.statusLabel.setStyle({ color: hexColor });
      this.statusLabel.setVisible(true);
    }
  }

  private clearStatus(): void {
    if (this.statusLabel) {
      this.statusLabel.setVisible(false);
      this.statusLabel.setText('');
    }
  }
}
