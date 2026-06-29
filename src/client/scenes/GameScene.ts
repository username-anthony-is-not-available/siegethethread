import { GameObjects, Scene } from 'phaser';
import * as Phaser from 'phaser';
import { exitExpandedMode } from '@devvit/web/client';
import {
  countPaths,
  createGrid,
  GRID_SIZE,
  isInRange,
  TILE_PATH,
  TILE_WALL,
  TOTAL_TILES,
  type Grid,
} from '../../shared/grid';
import { trpc } from '../trpc';
import type { PlayerClass, PlayerRole } from '../../shared/protocol';

const TILE_SIZE = 32;
const GRID_PIXELS = GRID_SIZE * TILE_SIZE;

const WALL_COLOR = 0x222222;
const PATH_COLOR = 0x555555;
const PENDING_COLOR = 0xffd166;
const ERROR_COLOR = 0xef233c;
const STROKE_COLOR = 0x000000;

const MODE_LABEL = 'Build Mode: Tap to Dig';

export class GameScene extends Scene {
  private grid: Grid = [];
  private tiles: GameObjects.Rectangle[][] = [];
  private modeLabel: GameObjects.Text | null = null;
  private counterLabel: GameObjects.Text | null = null;
  private statusLabel: GameObjects.Text | null = null;
  private energyLabel: GameObjects.Text | null = null;
  private originX = 0;
  private originY = 0;
  private pendingMutations = new Set<string>();
  private stagedMutations = new Map<string, {x: number; y: number; state: number}>();
  private commitButtonBg: GameObjects.Rectangle | null = null;
  private commitButtonText: GameObjects.Text | null = null;
  /** True once the server has responded with the initial map layout */
  private isMapLoaded = false;
  private exitRequested = false;
  private lastExitEvent: MouseEvent | undefined;
  private exitButtonBg: GameObjects.Rectangle | null = null;
  private exitButtonText: GameObjects.Text | null = null;
  private canvasClickListener: ((ev: MouseEvent) => void) | null = null;

  // Debug UI
  private debugBtn: GameObjects.Text | null = null;
  private debugPanel: GameObjects.Container | null = null;
  private isDebugExpanded = false;

  // Onboarding overlay container and objects
  private onboardingContainer: GameObjects.Container | null = null;
  private chosenClass: PlayerClass = 'Barbarian';
  private chosenRole: PlayerRole = 'Defender';
  private remainingAp = 0;
  private totalAp = 0;
  private userRole: PlayerRole | null = null;

  // Cinematic Replay state & assets
  private swarmSprites: Array<{
    container: GameObjects.Container;
    circle: GameObjects.Arc | GameObjects.Sprite;
    text: GameObjects.BitmapText;
    x: number;
    y: number;
    count: number;
    active: boolean;
  }> = [];
  private vaultChest: GameObjects.Container | null = null;
  private towerSprites: GameObjects.Container[] = [];
  private trapIndicators: GameObjects.Container[] = [];
  private rewardModalContainer: GameObjects.Container | null = null;
  private auraEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private pooledVfxEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  // Playback Timeline
  private replayPlaying = false;
  private replayData: {
    victory: 'Attacker' | 'Defender';
    frames: Array<{
      tick: number;
      swarms: Array<{ x: number; y: number; count: number }>;
    }>;
  } | null = null;
  private replayFrameIndex = 0;
  private replayAccumulator = 0;
  private REPLAY_TICK_DURATION = 800; // ms
  private activeSwarmNodes: Array<{
    sprite: { container: GameObjects.Container; circle: GameObjects.Arc | GameObjects.Sprite; text: GameObjects.BitmapText; x: number; y: number; count: number; active: boolean; };
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    startScale: number;
    targetScale: number;
    startAlpha: number;
    targetAlpha: number;
    isFadingOut: boolean;
  }> = [];
  private trapCoords: Array<{ x: number; y: number }> = [];


  constructor() {
    super('GameScene');
  }

  init(): void {
    this.grid = createGrid();
    this.tiles = [];
    this.modeLabel = null;
    this.counterLabel = null;
    this.statusLabel = null;
    this.energyLabel = null;
    this.pendingMutations.clear();
    this.stagedMutations.clear();
    this.isMapLoaded = false;
    this.exitRequested = false;
    this.lastExitEvent = undefined;
    this.exitButtonBg = null;
    this.exitButtonText = null;
    this.canvasClickListener = null;
    this.debugBtn = null;
    this.debugPanel = null;
    this.isDebugExpanded = false;
    this.onboardingContainer = null;
    this.userRole = null;

    // Reset cinematic replay objects
    this.swarmSprites = [];
    this.vaultChest = null;
    this.towerSprites = [];
    this.trapIndicators = [];
    this.rewardModalContainer = null;
    this.auraEmitter = null;
    this.pooledVfxEmitter = null;
  }


  preload(): void {
    // 1. Asset Loss Safeguards: Generate fallback textures if loading fails or for default use
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);

    // Generate RetroFont (BitmapFont) dynamically for swarm counts
    graphics.fillStyle(0x000000, 1);
    graphics.fillRect(0, 0, 100, 20); // Background to clear space, but we'll use a text object to generate texture
    graphics.clear();

    // We'll use a small hidden text object to generate the bitmap font texture

    // Generate actual Bitmap Font manually
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 14;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 10px Arial';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Character positions
    const chars = '0123456789';
    const charWidth = 10;
    const config: any = {
      image: 'swarm_font',
      width: 10,
      height: 14,
      chars: chars,
      charsPerRow: 10,
      // Type bypass for incorrect typings
      spacing: { x: 0, y: 0 } as any,
      lineSpacing: 0
    };

    for (let i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i]!, i * charWidth + (charWidth/2), 7);
    }
    this.textures.addCanvas('swarm_font', canvas);
    this.cache.bitmapFont.add('swarm_font', Phaser.GameObjects.RetroFont.Parse(this, config));


    // Fallback: Swarm Node
    graphics.fillStyle(0x00f0ff, 1);
    graphics.fillCircle(12, 12, 10);
    graphics.lineStyle(1.5, 0xffffff, 1);
    graphics.strokeCircle(12, 12, 10);
    graphics.generateTexture('swarm_fallback', 24, 24);
    graphics.clear();

    // Fallback: Particle Dot
    graphics.fillStyle(0xff7700, 1);
    graphics.fillCircle(4, 4, 3);
    graphics.generateTexture('particle_dot', 8, 8);
    graphics.clear();

    // Fallback: Blue/Cyan Particle Dot
    graphics.fillStyle(0x00f0ff, 1);
    graphics.fillCircle(4, 4, 3);
    graphics.generateTexture('particle_blue', 8, 8);
    graphics.clear();

    // Fallback: Vault (Treasure Chest Box)
    graphics.fillStyle(0xffd166, 1);
    graphics.fillRect(2, 2, 28, 28);
    graphics.lineStyle(2, 0x111622, 1);
    graphics.strokeRect(2, 2, 28, 28);
    graphics.fillStyle(0x111622, 1);
    graphics.fillRect(12, 12, 8, 12);
    graphics.generateTexture('vault_fallback', 32, 32);
    graphics.clear();

    // Fallback: Trap indicator (Skull / Spikes cross)
    graphics.lineStyle(2, 0xef233c, 1);
    graphics.strokeLineShape(new Phaser.Geom.Line(4, 4, 28, 28));
    graphics.strokeLineShape(new Phaser.Geom.Line(4, 28, 28, 4));
    graphics.fillStyle(0xef233c, 0.4);
    graphics.fillRect(4, 4, 24, 24);
    graphics.generateTexture('trap_fallback', 32, 32);
    graphics.clear();

    // Fallback: Defense Tower
    graphics.fillStyle(0x8d99ae, 1);
    graphics.fillRect(4, 0, 24, 32);
    graphics.fillStyle(0xd90429, 1);
    graphics.fillRect(8, 4, 16, 10);
    graphics.generateTexture('tower_fallback', 32, 32);
    graphics.clear();

    // Fallback: Tower Projectile Arrow / Dot
    graphics.fillStyle(0xffd166, 1);
    graphics.fillCircle(3, 3, 3);
    graphics.generateTexture('projectile_fallback', 6, 6);
    graphics.clear();
  }

  create(): void {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor(0x0b0d12);

    this.originX = Math.round((width - GRID_PIXELS) / 2);
    this.originY = Math.round((height - GRID_PIXELS) / 2);

    // Build overlay labels first so the loading state is visible immediately
    this.buildOverlay(width);

    // Show a loading indicator while waiting for the server
    this.showStatus('Checking player status…', 0xffd166);

    this.scale.on('resize', this.handleResize, this);

    this.canvasClickListener = (event: MouseEvent) => {
      this.lastExitEvent = event;
      if (this.exitRequested && this.pendingMutations.size === 0) {
        this.performExit();
      }
    };
    this.sys.game.canvas.addEventListener('click', this.canvasClickListener);
    this.buildCommitButton();

    // Run Pre-Flight check
    this.preFlightCheck();

    // Initialize the debug panel
    this.buildDebugPanel();

    // Initialize persistent pooled emitter
    if (!this.pooledVfxEmitter) {
      this.pooledVfxEmitter = this.add.particles(0, 0, 'particle_dot', {
        speed: { min: -120, max: 120 },
        angle: { min: 0, max: 360 },
        scale: { start: 1.5, end: 0 },
        blendMode: 'ADD',
        lifespan: 500,
        emitting: false,
      });
      this.pooledVfxEmitter.setDepth(20);
    }
  }


  private buildCommitButton(): void {
    const width = this.scale.width;
    const btnY = this.originY + GRID_PIXELS + 65;

    this.commitButtonBg = this.add.rectangle(width / 2, btnY, 200, 40, 0x06d6a0)
      .setInteractive({ useHandCursor: true })
      .setVisible(false);

    this.commitButtonText = this.add.text(width / 2, btnY, 'COMMIT BLUEPRINT', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '14px',
      color: '#000000',
    }).setOrigin(0.5).setVisible(false);

    this.commitButtonBg.on('pointerdown', () => this.commitStagedBlueprint());
  }

  private updateCommitButton(): void {
    if (!this.commitButtonBg || !this.commitButtonText) return;
    const hasStaged = this.stagedMutations.size > 0;
    this.commitButtonBg.setVisible(hasStaged);
    this.commitButtonText.setVisible(hasStaged);
  }

  private commitStagedBlueprint(): void {
    if (this.stagedMutations.size === 0) return;

    const mutations = Array.from(this.stagedMutations.values());

    // Disable button while saving
    if (this.commitButtonBg) this.commitButtonBg.disableInteractive();
    this.showStatus('COMMITTING BLUEPRINT...', 0xffd166);

    trpc.mutateTilesBatch
      .mutate({ mutations })
      .then((result) => {
        console.log(`[GameScene] TILE_BATCH_MUTATION_SUCCESS: committed ${result.mapped.length} changes`);

        // Remove from staging
        this.stagedMutations.clear();
        this.updateCommitButton();
        this.clearStatus();
        if (this.commitButtonBg) this.commitButtonBg.setInteractive({ useHandCursor: true });

        result.mapped.forEach((mut) => {
          const key = `${mut.y},${mut.x}`;
          this.pendingMutations.delete(key);
          this.finalizeTile(mut.y, mut.x, mut.state);
        });
      })
      .catch((err) => {
        console.error('[GameScene] TILE_BATCH_MUTATION failed:', err);
        this.showStatus('OUT OF ENERGY OR NETWORK ERROR!', ERROR_COLOR);
        this.time.delayedCall(2000, () => this.clearStatus());
        if (this.commitButtonBg) this.commitButtonBg.setInteractive({ useHandCursor: true });

        // Revert UI on failure (simplistic approach: just clear staging and refetch)
        this.stagedMutations.clear();
        this.updateCommitButton();
        this.fetchInitialMap(); // Refetch to sync state
      });
  }


  private preFlightCheck(): void {
    trpc.getProfileStatus.query()
      .then((status) => {
        if (!status.hasProfile || !status.profile) {
          this.clearStatus();
          this.showOnboardingOverlay();
        } else {
          this.userRole = status.profile.role;
          this.remainingAp = status.remainingAp;
          this.totalAp = status.totalAp;
          this.clearStatus();
          this.loadGameContent();
        }
      })
      .catch((err) => {
        console.error('[GameScene] Profile status check failed:', err);
        this.showStatus('Profile check failed. Tap to retry.', ERROR_COLOR);
        this.input.once('pointerdown', () => this.preFlightCheck());
      });
  }

  private loadGameContent(): void {
    this.fetchInitialMap();
    this.fetchEnergyStatus();
  }

  private fetchEnergyStatus(): void {
    trpc.getRemainingEnergy.query()
      .then((result) => {
        this.remainingAp = result.remainingAp;
        this.totalAp = result.totalAp;
        this.updateEnergyHud();
      })
      .catch((err) => {
        console.error('[GameScene] Error loading energy:', err);
      });
  }

  private updateEnergyHud(): void {
    if (!this.energyLabel) {
      return;
    }
    if (this.userRole !== 'Defender') {
      this.energyLabel.setText('⚔️ Attacker Mode (View Only)');
      return;
    }
    if (this.remainingAp <= 0) {
      this.energyLabel.setText('⚡ Energy: 0 / 20 AP (OUT OF ENERGY!)');
      this.energyLabel.setStyle({ color: '#ef233c' });
    } else {
      this.energyLabel.setText(`⚡ Energy: ${this.remainingAp} / ${this.totalAp} AP`);
      this.energyLabel.setStyle({ color: '#06d6a0' });
    }
  }

  // ---------------------------------------------------------------------------
  // High-fidelity Onboarding UI
  // ---------------------------------------------------------------------------

  private showOnboardingOverlay(): void {
    const width = this.scale.width;
    const height = this.scale.height;

    this.onboardingContainer = this.add.container(0, 0).setDepth(20);

    // Semi-transparent backdrop
    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0.85);
    this.onboardingContainer.add(bg);

    // Modal panel card
    const modalWidth = 480;
    const modalHeight = 360;
    const panel = this.add.rectangle(width / 2, height / 2, modalWidth, modalHeight, 0x161a22)
      .setStrokeStyle(2, 0xffd166);
    this.onboardingContainer.add(panel);

    const title = this.add.text(width / 2, height / 2 - 140, 'CHARACTER CREATION', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '24px',
      color: '#ffd166',
    }).setOrigin(0.5);
    this.onboardingContainer.add(title);

    // Class selection title
    const classTitle = this.add.text(width / 2, height / 2 - 90, 'Choose Your Diablo Class', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#a0aab2',
    }).setOrigin(0.5);
    this.onboardingContainer.add(classTitle);

    // Option containers for Barbarian, Sorcerer, Rogue
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

      this.onboardingContainer?.add(btn);
      this.onboardingContainer?.add(txt);
      classButtons.push(btn);
      classTexts.push(txt);
    });

    // Role selection title
    const roleTitle = this.add.text(width / 2, height / 2 + 30, 'Choose Daily Operational Role', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '14px',
      color: '#a0aab2',
    }).setOrigin(0.5);
    this.onboardingContainer.add(roleTitle);

    // Role Pickers: Raid Attacker vs Build Defender
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

      this.onboardingContainer?.add(btn);
      this.onboardingContainer?.add(txt);
      roleButtons.push(btn);
      roleTexts.push(txt);
    });

    // Submit button
    const submitBtn = this.add.rectangle(width / 2, height / 2 + 140, 160, 40, 0x06d6a0)
      .setInteractive({ useHandCursor: true });
    const submitTxt = this.add.text(width / 2, height / 2 + 140, 'ENTER DUNGEON', {
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
        this.userRole = profile.role;
        this.clearStatus();
        this.onboardingContainer?.destroy();
        this.loadGameContent();
      })
      .catch((err) => {
        console.error('[GameScene] Failed to initialize profile:', err);
        this.showStatus('Failed to create profile. Try again.', ERROR_COLOR);
        submitBtn.setInteractive({ useHandCursor: true });
      });
    });

    this.onboardingContainer.add(submitBtn);
    this.onboardingContainer.add(submitTxt);
  }

  // ---------------------------------------------------------------------------
  // Network: initial map fetch
  // ---------------------------------------------------------------------------

  private fetchInitialMap(): void {
    trpc.getMap
      .query()
      .then((result: { map: string }) => {
        console.log('[GameScene] FETCH_MAP_RESPONSE received, rendering grid');
        const serverGrid = this.parseMapString(result.map);
        this.grid = serverGrid;
        this.isMapLoaded = true;
        this.buildGrid();
        this.clearStatus();
        this.updateCounter();
      })
      .catch((err: unknown) => {
        const httpStatus = (err as { shape?: { data?: { httpStatus?: number } } }).shape?.data?.httpStatus ?? 'unknown';
        console.error(`[GameScene] Load failed (HTTP: ${httpStatus}):`, err);
        this.showStatus('Map not found. Tap to retry.', ERROR_COLOR);
        this.input.once('pointerdown', () => this.fetchInitialMap());
      });
  }

  // ---------------------------------------------------------------------------
  // Grid rendering (deferred until map is loaded)
  // ---------------------------------------------------------------------------

  private buildGrid(): void {
    // Clear any previously rendered tiles (e.g., on retry)
    for (const row of this.tiles) {
      for (const tile of row) {
        tile.destroy();
      }
    }
    this.tiles = [];

    for (let row = 0; row < GRID_SIZE; row++) {
      this.tiles[row] = [];
      const gridRow = this.grid[row];
      if (!gridRow) {
        continue;
      }
      for (let col = 0; col < GRID_SIZE; col++) {
        const state = gridRow[col] ?? TILE_WALL;
        const x = this.originX + col * TILE_SIZE + TILE_SIZE / 2;
        const y = this.originY + row * TILE_SIZE + TILE_SIZE / 2;
        const tile = this.add
          .rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, this.colorForState(state))
          .setStrokeStyle(1, STROKE_COLOR, 0.25)
          .setInteractive({ useHandCursor: true });
        tile.on('pointerdown', () => {
          this.handleTileClick(row, col);
        });
        const tileRow = this.tiles[row];
        if (tileRow) {
          tileRow[col] = tile;
        }
      }
    }
  }

  private buildOverlay(width: number): void {
    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '22px',
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    };
    const counterStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '18px',
      color: '#06d6a0',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    };
    const statusStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '16px',
      color: '#ffd166',
      stroke: '#000000',
      strokeThickness: 3,
      align: 'center',
    };

    this.modeLabel = this.add
      .text(width / 2, this.originY - 45, MODE_LABEL, labelStyle)
      .setOrigin(0.5);
    
    this.energyLabel = this.add
      .text(width / 2, this.originY - 15, '⚡ Energy: -- / 20 AP', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '14px',
        color: '#06d6a0',
        stroke: '#000000',
        strokeThickness: 3,
      })
      .setOrigin(0.5);

    this.counterLabel = this.add
      .text(width / 2, this.originY + GRID_PIXELS + 40, '', counterStyle)
      .setOrigin(0.5);
    this.statusLabel = this.add
      .text(width / 2, this.originY + GRID_PIXELS / 2, '', statusStyle)
      .setOrigin(0.5)
      .setDepth(10);

    const exitX = width - 90;
    const exitY = 30;
    this.exitButtonBg = this.add
      .rectangle(exitX, exitY, 130, 34, 0xff4500)
      .setInteractive({ useHandCursor: true });
    this.exitButtonText = this.add
      .text(exitX, exitY, 'Save & Exit', {
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    this.exitButtonBg.on('pointerover', () => {
      this.exitButtonBg?.setFillStyle(0xff6a00);
    });
    this.exitButtonBg.on('pointerout', () => {
      this.exitButtonBg?.setFillStyle(0xff4500);
    });
    this.exitButtonBg.on('pointerup', () => {
      this.handleExit();
    });
  }

  // ---------------------------------------------------------------------------
  // Tile interaction
  // ---------------------------------------------------------------------------

  private handleTileClick(row: number, col: number): void {
    // Guard: do nothing if the map isn't loaded yet
    if (!this.isMapLoaded) {
      return;
    }
    if (!isInRange(this.grid, row, col)) {
      return;
    }
    const key = `${row},${col}`;
    if (this.pendingMutations.has(key)) {
      return;
    }

    if (this.userRole !== 'Defender') {
      this.showStatus('ONLY DEFENDERS CAN DIG!', ERROR_COLOR);
      this.time.delayedCall(1500, () => this.clearStatus());
      return;
    }

    if (this.remainingAp <= 0) {
      this.showStatus('OUT OF ENERGY!', ERROR_COLOR);
      this.time.delayedCall(1500, () => this.clearStatus());
      return;
    }

    const currentState = this.grid[row]?.[col] ?? TILE_WALL;
    const desiredState = currentState === TILE_WALL ? TILE_PATH : TILE_WALL;

    this.setTilePending(row, col);
    this.pendingMutations.add(key);

    // Optimistic update on local grid for counter display
    const rowCells = this.grid[row];
    if (rowCells) {
      rowCells[col] = desiredState;
    }
    this.updateCounter();

    trpc.mutateTile
      .mutate({ x: col, y: row, state: desiredState })
      .then((result: { x: number; y: number; state: number }) => {
        console.log(`[GameScene] TILE_MUTATION_SUCCESS (${result.x}, ${result.y}) → ${result.state}`);
        this.remainingAp = Math.max(0, this.remainingAp - 1);
        this.updateEnergyHud();
        this.finalizeTile(result.y, result.x, result.state);
      })
      .catch((err: unknown) => {
        console.error(`[GameScene] TILE_MUTATION failed for (${col}, ${row}):`, err);
        
        this.showStatus('OUT OF ENERGY OR WRONG ROLE!', ERROR_COLOR);
        this.time.delayedCall(2000, () => this.clearStatus());

        const revertRow = this.grid[row];
        if (revertRow) {
          revertRow[col] = currentState;
        }
        this.revertTile(row, col, currentState);
        this.updateCounter();
        this.fetchEnergyStatus();
      });
  }

  private handleExit(): void {
    if (this.exitRequested) {
      return;
    }
    this.exitRequested = true;
    if (this.pendingMutations.size > 0) {
      this.showStatus('Saving changes…', 0xffd166);
    } else {
      this.performExit();
    }
  }

  private performExit(): void {
    if (this.lastExitEvent) {
      try {
        exitExpandedMode(this.lastExitEvent);
      } catch (err: unknown) {
        console.error('[GameScene] Failed to exit expanded mode:', err);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Tile visual states
  // ---------------------------------------------------------------------------

  private setTilePending(row: number, col: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    tile.setFillStyle(PENDING_COLOR, 0.5);
    this.tweens.add({
      targets: tile,
      alpha: 0.65,
      duration: 300,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private finalizeTile(row: number, col: number, state: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    this.tweens.killTweensOf(tile);
    tile.setAlpha(1);
    tile.setFillStyle(this.colorForState(state));

    const rowCells = this.grid[row];
    if (!rowCells) {
      return;
    }
    rowCells[col] = state;
    this.pendingMutations.delete(`${row},${col}`);
    this.updateCounter();
    if (this.exitRequested && this.pendingMutations.size === 0) {
      this.performExit();
    }
  }

  private revertTile(row: number, col: number, originalState: number): void {
    const tile = this.tiles[row]?.[col];
    if (!tile) {
      return;
    }
    this.tweens.killTweensOf(tile);
    tile.setAlpha(1);
    tile.setFillStyle(ERROR_COLOR);
    this.tweens.add({
      targets: tile,
      alpha: 0,
      duration: 200,
      yoyo: true,
      repeat: 1,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        tile.setFillStyle(this.colorForState(originalState));
        tile.setAlpha(1);
      },
    });
    this.pendingMutations.delete(`${row},${col}`);
    if (this.exitRequested && this.pendingMutations.size === 0) {
      this.performExit();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private parseMapString(mapString: string): Grid {
    const parsed: Grid = [];
    for (let row = 0; row < GRID_SIZE; row++) {
      parsed[row] = [];
      for (let col = 0; col < GRID_SIZE; col++) {
        const index = row * GRID_SIZE + col;
        const char = mapString[index] ?? '0';
        const rowCells = parsed[row];
        if (rowCells) {
          rowCells[col] = parseInt(char, 10);
        }
      }
    }
    return parsed;
  }

  private showStatus(message: string, color: number): void {
    if (!this.statusLabel) {
      return;
    }
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    this.statusLabel.setStyle({ color: hex });
    this.statusLabel.setText(message);
    this.statusLabel.setVisible(true);
  }

  private clearStatus(): void {
    if (this.statusLabel) {
      this.statusLabel.setVisible(false);
    }
  }

  private updateCounter(): void {
    if (!this.counterLabel) {
      return;
    }
    const dug = countPaths(this.grid);
    this.counterLabel.setText(`Total Paths Dug: ${dug} / ${TOTAL_TILES}`);
  }

  private colorForState(state: number): number {
    return state === TILE_PATH ? PATH_COLOR : WALL_COLOR;
  }

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  private handleResize(gameSize: Phaser.Structs.Size): void {
    const width = gameSize.width;
    const height = gameSize.height;
    this.cameras.resize(width, height);
    this.originX = Math.round((width - GRID_PIXELS) / 2);
    this.originY = Math.round((height - GRID_PIXELS) / 2);

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const tile = this.tiles[row]?.[col];
        if (!tile) {
          continue;
        }
        tile.setPosition(
          this.originX + col * TILE_SIZE + TILE_SIZE / 2,
          this.originY + row * TILE_SIZE + TILE_SIZE / 2
        );
      }
    }

    if (this.modeLabel) {
      this.modeLabel.setPosition(width / 2, this.originY - 45);
    }
    if (this.energyLabel) {
      this.energyLabel.setPosition(width / 2, this.originY - 15);
    }
    if (this.counterLabel) {
      this.counterLabel.setPosition(width / 2, this.originY + GRID_PIXELS + 40);
    }
    if (this.statusLabel) {
      this.statusLabel.setPosition(width / 2, this.originY + GRID_PIXELS / 2);
    }
    if (this.exitButtonBg) {
      this.exitButtonBg.setPosition(width - 90, 30);
    }
    if (this.exitButtonText) {
      this.exitButtonText.setPosition(width - 90, 30);
    }

    this.buildDebugPanel();
  }

  private buildDebugPanel(): void {
    if (this.debugBtn) {
      this.debugBtn.destroy();
    }
    if (this.debugPanel) {
      this.debugPanel.destroy();
    }

    const btnX = 20;
    const btnY = 20;

    this.debugBtn = this.add.text(btnX, btnY, '⚙️ DEBUG', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '14px',
      color: '#ffffff',
      backgroundColor: '#1d2433',
      padding: { x: 10, y: 6 }
    })
    .setInteractive({ useHandCursor: true })
    .setDepth(30);

    this.debugBtn.on('pointerover', () => this.debugBtn?.setStyle({ color: '#ffd166' }));
    this.debugBtn.on('pointerout', () => this.debugBtn?.setStyle({ color: '#ffffff' }));
    this.debugBtn.on('pointerdown', () => {
      this.isDebugExpanded = !this.isDebugExpanded;
      this.debugPanel?.setVisible(this.isDebugExpanded);
    });

    this.debugPanel = this.add.container(btnX, btnY + 40).setDepth(30).setVisible(this.isDebugExpanded);

    const panelBg = this.add.rectangle(110, 75, 220, 140, 0x111622)
      .setStrokeStyle(2, 0xffd166);
    this.debugPanel.add(panelBg);

    const toggleBtn = this.add.text(10, 15, 'Toggle Role', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#222831',
      padding: { x: 8, y: 4 }
    })
    .setInteractive({ useHandCursor: true });
    
    toggleBtn.on('pointerdown', () => {
      const nextRole = this.userRole === 'Defender' ? 'Attacker' : 'Defender';
      trpc.debug_setPlayerRole.mutate({ targetRole: nextRole })
        .then((profile) => {
          this.userRole = profile.role;
          this.remainingAp = nextRole === 'Defender' ? 20 : 0;
          this.updateEnergyHud();
          this.showStatus(`Role set to ${profile.role}!`, 0x06d6a0);
          this.time.delayedCall(1500, () => this.clearStatus());
          this.fetchInitialMap(); // Refresh map/state
        })
        .catch((err) => {
          console.error('[Debug] Failed to toggle role:', err);
          this.showStatus('Debug failed', ERROR_COLOR);
        });
    });
    this.debugPanel.add(toggleBtn);

    const refillBtn = this.add.text(110, 15, 'Refill AP', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#222831',
      padding: { x: 8, y: 4 }
    })
    .setInteractive({ useHandCursor: true });

    refillBtn.on('pointerdown', () => {
      trpc.debug_refillEnergy.mutate()
        .then((result) => {
          this.remainingAp = result.remainingAp;
          this.totalAp = result.totalAp;
          this.updateEnergyHud();
          this.showStatus('AP Refilled to 20!', 0x06d6a0);
          this.time.delayedCall(1500, () => this.clearStatus());
        })
        .catch((err) => {
          console.error('[Debug] Failed to refill energy:', err);
          this.showStatus('Debug failed', ERROR_COLOR);
        });
    });
    this.debugPanel.add(refillBtn);

    const simBtn = this.add.text(10, 55, 'Trigger Matchmaker Now', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#222831',
      padding: { x: 8, y: 4 }
    })
    .setInteractive({ useHandCursor: true });

    simBtn.on('pointerdown', () => {
      let apiDone = false;
      let minDurationElapsed = false;
      let matchResult: {
        victory: 'Attacker' | 'Defender';
        frames: Array<{
          tick: number;
          swarms: Array<{ x: number; y: number; count: number }>;
        }>;
        success: boolean;
      } | null = null;

      const overlayController = this.showMatchmakingOverlay(() => {
        if (matchResult) {
          this.playCinematicReplay({
            victory: matchResult.victory,
            frames: matchResult.frames,
          });
        }
      });

      trpc.debug_triggerMatchmakerSimulation.mutate()
        .then((res) => {
          matchResult = res;
          apiDone = true;
          if (minDurationElapsed) {
            overlayController.proceedToMatchFound();
          }
        })
        .catch((err) => {
          console.error('[Debug] Failed to run matchmaker simulation:', err);
          overlayController.cancel();
          this.showStatus('Debug failed', ERROR_COLOR);
          this.time.delayedCall(1500, () => this.clearStatus());
        });

      // Enforce a minimum of 1.5 seconds of searching animation for dramatic timing
      this.time.delayedCall(1500, () => {
        minDurationElapsed = true;
        if (apiDone && matchResult) {
          overlayController.proceedToMatchFound();
        }
      });
    });
    this.debugPanel.add(simBtn);

    const resetBtn = this.add.text(10, 95, 'Full Reset', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '12px',
      color: '#ffffff',
      backgroundColor: '#ef233c',
      padding: { x: 8, y: 4 }
    })
    .setInteractive({ useHandCursor: true });

    resetBtn.on('pointerdown', () => {
      this.showStatus('Resetting state...', 0xffd166);
      trpc.debug_fullReset.mutate()
        .then((res) => {
          this.clearStatus();
          this.userRole = null;
          this.remainingAp = res.remainingAp;
          this.totalAp = res.totalAp;
          this.isMapLoaded = false;
          // Clear any current onboarding panel if visible
          if (this.onboardingContainer) {
            this.onboardingContainer.destroy();
            this.onboardingContainer = null;
          }
          this.preFlightCheck();
        })
        .catch((err) => {
          console.error('[Debug] Failed to execute full reset:', err);
          this.showStatus('Reset failed', ERROR_COLOR);
          this.time.delayedCall(1500, () => this.clearStatus());
        });
    });
    this.debugPanel.add(resetBtn);
  }

  private pathOverlayGraphics: GameObjects.Graphics | null = null;
  private swarmTextObjects: GameObjects.Text[] = [];

  private clearSwarmAnimation(): void {
    if (this.pathOverlayGraphics) {
      this.pathOverlayGraphics.destroy();
      this.pathOverlayGraphics = null;
    }
    this.swarmTextObjects.forEach((t) => t.destroy());
    this.swarmTextObjects = [];


    // Clear pool sprites
    this.swarmSprites.forEach(s => {
      s.container.destroy();
    });
    this.swarmSprites = [];

    // Clear towers, traps, vault chest
    this.towerSprites.forEach(t => t.destroy());
    this.towerSprites = [];
    this.trapIndicators.forEach(t => t.destroy());
    this.trapIndicators = [];
    
    if (this.vaultChest) {
      this.vaultChest.destroy();
      this.vaultChest = null;
    }
    if (this.auraEmitter) {
      this.auraEmitter.destroy();
      this.auraEmitter = null;
    }
    if (this.rewardModalContainer) {
      this.rewardModalContainer.destroy();
      this.rewardModalContainer = null;
    }
  }



  private triggerTrapVFXPooled(px: number, py: number): void {
    if (this.pooledVfxEmitter) {
      this.pooledVfxEmitter.setPosition(px, py);
      this.pooledVfxEmitter.explode(20); // instantaneous burst of 20 particles
    }
  }

  private fireTowerProjectile(fromX: number, fromY: number, toX: number, toY: number): void {
    const proj = this.add.circle(fromX, fromY, 3, 0xffd166).setDepth(17);
    this.tweens.add({
      targets: proj,
      x: toX,
      y: toY,
      duration: 200,
      ease: 'Linear',
      onComplete: () => {
        proj.destroy();
      }
    });
  }

  private playCinematicReplay(replayData: {
    victory: 'Attacker' | 'Defender';
    frames: Array<{
      tick: number;
      swarms: Array<{ x: number; y: number; count: number }>;
    }>;
  }): void {
    this.clearSwarmAnimation();

    const graphics = this.add.graphics().setDepth(15);
    this.pathOverlayGraphics = graphics;

    // Spawn towers and traps dynamically on the board
    this.trapCoords = [];
    let towerCount = 0;

    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        if (this.grid[r]?.[c] === TILE_WALL && towerCount < 4 && r > 2 && c > 2) {
          let hasAdjPath = false;
          const neighbors = [
            { r: r - 1, c }, { r: r + 1, c }, { r, c: c - 1 }, { r, c: c + 1 }
          ];
          for (const n of neighbors) {
            if (n.r >= 0 && n.r < GRID_SIZE && n.c >= 0 && n.c < GRID_SIZE) {
              if (this.grid[n.r]?.[n.c] === TILE_PATH) {
                hasAdjPath = true;
                break;
              }
            }
          }
          if (hasAdjPath) {
            const px = this.originX + c * TILE_SIZE + TILE_SIZE / 2;
            const py = this.originY + r * TILE_SIZE + TILE_SIZE / 2;
            const towerContainer = this.add.container(px, py).setDepth(14);
            const towerBg = this.add.rectangle(0, 0, 24, 32, 0x8d99ae).setStrokeStyle(1.5, 0xd90429);
            towerContainer.add(towerBg);
            this.towerSprites.push(towerContainer);
            towerCount++;
          }
        } else if (this.grid[r]?.[c] === TILE_PATH && this.trapCoords.length < 4 && r > 1 && c > 1 && (r !== 15 || c !== 15)) {
          if ((r + c) % 5 === 0) {
            const px = this.originX + c * TILE_SIZE + TILE_SIZE / 2;
            const py = this.originY + r * TILE_SIZE + TILE_SIZE / 2;
            const trapContainer = this.add.container(px, py).setDepth(11);
            const trapBg = this.add.rectangle(0, 0, 24, 24, 0xef233c, 0.4).setStrokeStyle(2, 0xef233c);
            trapBg.setScale(0.8);
            trapBg.setAlpha(0.65);
            trapContainer.add(trapBg);
            this.trapIndicators.push(trapContainer);
            this.trapCoords.push({ x: c, y: r });
          }
        }
      }
    }

    // Spawn Vault at (15, 15)
    const vpx = this.originX + 15 * TILE_SIZE + TILE_SIZE / 2;
    const vpy = this.originY + 15 * TILE_SIZE + TILE_SIZE / 2;
    this.vaultChest = this.add.container(vpx, vpy).setDepth(15);
    const chestBg = this.add.rectangle(0, 0, 28, 28, 0xffd166).setStrokeStyle(2, 0x111622);
    this.vaultChest.add(chestBg);

    // Magical blue aura flows from Vault
    this.auraEmitter = this.add.particles(vpx, vpy, 'particle_blue', {
      speedY: { min: -50, max: -20 },
      speedX: { min: -20, max: 20 },
      scale: { start: 1, end: 0 },
      blendMode: 'ADD',
      lifespan: 1000,
      frequency: 150,
    });

    // Initialize timeline playback
    this.replayData = replayData;
    this.replayFrameIndex = 0;
    this.replayAccumulator = 0;
    this.replayPlaying = true;

    // Process first frame immediately
    this.advanceReplayFrame();
  }


  private advanceReplayFrame(): void {
    if (!this.replayData || !this.replayPlaying) return;

    const currentFrame = this.replayData.frames[this.replayFrameIndex];
    if (!currentFrame) {
      // End of replay
      this.replayPlaying = false;
      this.time.delayedCall(1200, () => {
        if (this.replayData) {
          this.showRewardModal(this.replayData.victory);
        }
      });
      return;
    }

    const nextActiveSprites: typeof this.swarmSprites = [];
    const newActiveNodes: typeof this.activeSwarmNodes = [];


    currentFrame.swarms.forEach((swarm) => {
      // Find closest active sprite from last frame
      let bestSprite: { container: GameObjects.Container; circle: GameObjects.Arc | GameObjects.Sprite; text: GameObjects.BitmapText; x: number; y: number; count: number; active: boolean; } | null = null;
      let minDist = Infinity;

      for (const s of this.swarmSprites) {
        if (s.active && !nextActiveSprites.includes(s)) {
          const dist = Math.abs(s.x - swarm.x) + Math.abs(s.y - swarm.y);
          if (dist < minDist) {
            minDist = dist;
            bestSprite = s;
          }
        }
      }

      let targetSprite: { container: GameObjects.Container; circle: GameObjects.Arc | GameObjects.Sprite; text: GameObjects.BitmapText; x: number; y: number; count: number; active: boolean; };
      let startX = swarm.x;
      let startY = swarm.y;
      let targetScale = 1;
      let startScale = 1;
      let targetAlpha = 1;
      let startAlpha = 1;

      if (bestSprite && minDist <= 1.5) {
        targetSprite = bestSprite;
        startX = targetSprite.x;
        startY = targetSprite.y;
        startScale = targetSprite.container.scale;
        targetSprite.x = swarm.x;
        targetSprite.y = swarm.y;
      } else {
        // Split or initial spawn
        if (bestSprite) {
          startX = bestSprite.x;
          startY = bestSprite.y;
        }

        const inactive = this.swarmSprites.find(s => !s.active && !nextActiveSprites.includes(s));
        if (inactive) {
          targetSprite = inactive;
          targetSprite.active = true;
          targetSprite.container.setVisible(true);
          const px = this.originX + startX * TILE_SIZE + TILE_SIZE / 2;
          const py = this.originY + startY * TILE_SIZE + TILE_SIZE / 2;
          targetSprite.container.setPosition(px, py);
          targetSprite.x = swarm.x;
          targetSprite.y = swarm.y;
          startScale = 1;
          startAlpha = 1;
        } else {
          const px = this.originX + startX * TILE_SIZE + TILE_SIZE / 2;
          const py = this.originY + startY * TILE_SIZE + TILE_SIZE / 2;
          const container = this.add.container(px, py).setDepth(16);
          container.setScale(0); // Pop in

          const visual = this.add.circle(0, 0, 10, 0x00f0ff).setStrokeStyle(1.5, 0xffffff);
          container.add(visual);

          const txt = this.add.bitmapText(0, -18, 'swarm_font', String(swarm.count), 10).setOrigin(0.5);
          container.add(txt);

          targetSprite = {
            container,
            circle: visual,
            text: txt,
            x: swarm.x,
            y: swarm.y,
            count: swarm.count,
            active: true
          };
          this.swarmSprites.push(targetSprite);

          startScale = 0;
          startAlpha = 1;
        }
      }

      nextActiveSprites.push(targetSprite);

      const targetPx = this.originX + swarm.x * TILE_SIZE + TILE_SIZE / 2;
      const targetPy = this.originY + swarm.y * TILE_SIZE + TILE_SIZE / 2;
      const startPx = this.originX + startX * TILE_SIZE + TILE_SIZE / 2;
      const startPy = this.originY + startY * TILE_SIZE + TILE_SIZE / 2;

      // Detect trap triggers or count drop
      const isTrapTile = this.trapCoords.some(tc => tc.x === swarm.x && tc.y === swarm.y);
      const countDropped = targetSprite.count > swarm.count;

      if (isTrapTile || countDropped) {
        this.triggerTrapVFXPooled(targetPx, targetPy);
        // Find closest tower to fire projectile
        let closestTower: GameObjects.Container | null = null;
        let minTowerDist = Infinity;
        this.towerSprites.forEach(t => {
          const dist = Phaser.Math.Distance.Between(t.x, t.y, targetPx, targetPy);
          if (dist < minTowerDist) {
            minTowerDist = dist;
            closestTower = t;
          }
        });
        if (closestTower) {
          this.fireTowerProjectile((closestTower as GameObjects.Container).x, (closestTower as GameObjects.Container).y, targetPx, targetPy);
        }
      }

      // Vault breach check
      if (swarm.x === 15 && swarm.y === 15 && this.replayData?.victory === 'Attacker') {
        this.cameras.main.shake(500, 0.02);
        if (this.vaultChest) {
          this.tweens.add({
            targets: this.vaultChest,
            scaleX: 1.6,
            scaleY: 1.6,
            duration: 600,
            ease: 'Back.easeOut'
          });
        }
      }

      const prevCount = targetSprite.count;
      targetSprite.text.setText(String(swarm.count));
      targetSprite.count = swarm.count;

      if (prevCount !== swarm.count) {
        // Pulsate
        targetScale = 1.25;
      }

      newActiveNodes.push({
        sprite: targetSprite,
        startX: startPx,
        startY: startPy,
        targetX: targetPx,
        targetY: targetPy,
        startScale,
        targetScale,
        startAlpha,
        targetAlpha,
        isFadingOut: false
      });
    });

    // Handle inactive sprites (fade out)
    this.swarmSprites.forEach(s => {
      if (s.active && !nextActiveSprites.includes(s)) {
        s.active = false;
        newActiveNodes.push({
          sprite: s,
          startX: s.container.x,
          startY: s.container.y,
          targetX: s.container.x,
          targetY: s.container.y,
          startScale: s.container.scale,
          targetScale: s.container.scale,
          startAlpha: s.container.alpha,
          targetAlpha: 0,
          isFadingOut: true
        });
      }
    });

    this.activeSwarmNodes = newActiveNodes;
    this.replayFrameIndex++;
  }

  private showMatchmakingOverlay(onMatchFound: () => void): { proceedToMatchFound: () => void; cancel: () => void } {
    const width = this.scale.width;
    const height = this.scale.height;

    const overlay = this.add.container(0, 0).setDepth(100);

    const bg = this.add.rectangle(width / 2, height / 2, width, height, 0x070b19, 0.95);
    overlay.add(bg);

    const panelW = 400;
    const panelH = 250;
    const panelBg = this.add.rectangle(width / 2, height / 2, panelW, panelH, 0x0e172a)
      .setStrokeStyle(3, 0x00f0ff);
    overlay.add(panelBg);

    const scannerGraphics = this.add.graphics();
    scannerGraphics.lineStyle(2, 0x00f0ff, 0.3);
    scannerGraphics.strokeCircle(width / 2, height / 2 - 20, 60);
    scannerGraphics.strokeCircle(width / 2, height / 2 - 20, 40);
    overlay.add(scannerGraphics);

    const sweepLine = this.add.graphics();
    overlay.add(sweepLine);

    const sweepTween = this.tweens.addCounter({
      from: 0,
      to: 360,
      duration: 2000,
      loop: -1,
      onUpdate: (tween) => {
        sweepLine.clear();
        const angle = Phaser.Math.DegToRad(tween.getValue() ?? 0);
        sweepLine.lineStyle(3, 0x00f0ff, 0.8);
        sweepLine.lineBetween(
          width / 2, 
          height / 2 - 20, 
          width / 2 + Math.cos(angle) * 60, 
          height / 2 - 20 + Math.sin(angle) * 60
        );
      }
    });

    const searchText = this.add.text(width / 2, height / 2 + 65, '📡 CONNECTING TO SWARM PROTOCOL...', {
      fontFamily: 'Courier New, monospace',
      fontSize: '14px',
      color: '#00f0ff',
      stroke: '#000000',
      strokeThickness: 3
    }).setOrigin(0.5);
    overlay.add(searchText);

    this.tweens.add({
      targets: searchText,
      alpha: 0.3,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut'
    });

    const statusText = this.add.text(width / 2, height / 2 + 90, 'RETRIEVING DEFENSIVE GRID...', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '11px',
      color: '#94a3b8'
    }).setOrigin(0.5);
    overlay.add(statusText);

    const statusMessages = [
      'RETRIEVING DEFENSIVE GRID...',
      'ESTABLISHING ENCRYPTED CORRIDOR...',
      'CALCULATING OPTIMAL INVASION VECTORS...',
      'SWARM READY. ENEMY THREADS IN SIGHT.'
    ];
    let msgIdx = 0;
    const msgTimer = this.time.addEvent({
      delay: 450,
      callback: () => {
        msgIdx = (msgIdx + 1) % statusMessages.length;
        if (statusText.active) {
          statusText.setText(statusMessages[msgIdx] || '');
        }
      },
      loop: true
    });

    const proceedToMatchFound = () => {
      sweepTween.stop();
      sweepLine.destroy();
      scannerGraphics.destroy();
      msgTimer.destroy();
      statusText.destroy();

      searchText.setText('🔥 MATCH SECURED 🔥');
      searchText.setStyle({
        fontFamily: 'Impact, Arial Black, sans-serif',
        fontSize: '28px',
        color: '#ff3366',
        stroke: '#000000',
        strokeThickness: 5
      });
      searchText.setPosition(width / 2, height / 2 - 40);

      this.tweens.add({
        targets: searchText,
        scaleX: 1.2,
        scaleY: 1.2,
        duration: 300,
        yoyo: true,
        repeat: 1,
        ease: 'Back.easeOut'
      });

      const versusText = this.add.text(width / 2, height / 2 + 10, 'SWARM vs DEFENSIVE GRID', {
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontSize: '14px',
        color: '#ffd166',
        stroke: '#000000',
        strokeThickness: 3
      }).setOrigin(0.5).setScale(0);
      overlay.add(versusText);

      this.tweens.add({
        targets: versusText,
        scaleX: 1,
        scaleY: 1,
        duration: 400,
        ease: 'Back.easeOut',
        delay: 200
      });

      const countdownText = this.add.text(width / 2, height / 2 + 65, 'SIMULATING IN 3...', {
        fontFamily: 'Impact, Arial Black, sans-serif',
        fontSize: '24px',
        color: '#00ffcc',
        stroke: '#000000',
        strokeThickness: 4
      }).setOrigin(0.5).setScale(0);
      overlay.add(countdownText);

      this.tweens.add({
        targets: countdownText,
        scaleX: 1,
        scaleY: 1,
        duration: 300,
        ease: 'Back.easeOut',
        delay: 500
      });

      let secondsLeft = 3;
      const countTimer = this.time.addEvent({
        delay: 800,
        callback: () => {
          secondsLeft--;
          if (secondsLeft > 0) {
            countdownText.setText(`SIMULATING IN ${secondsLeft}...`);
            countdownText.setScale(0);
            this.tweens.add({
              targets: countdownText,
              scaleX: 1,
              scaleY: 1,
              duration: 300,
              ease: 'Back.easeOut'
            });
          } else if (secondsLeft === 0) {
            countdownText.setText('INVASION!');
            countdownText.setStyle({ color: '#ff003c' });
            countdownText.setScale(0);
            this.tweens.add({
              targets: countdownText,
              scaleX: 1.5,
              scaleY: 1.5,
              duration: 400,
              ease: 'Back.easeOut'
            });
            this.cameras.main.flash(400, 255, 0, 60, true);
          } else {
            countTimer.destroy();
            this.tweens.add({
              targets: overlay,
              alpha: 0,
              duration: 400,
              onComplete: () => {
                overlay.destroy();
                onMatchFound();
              }
            });
          }
        },
        repeat: 4
      });
    };

    return {
      proceedToMatchFound,
      cancel: () => {
        sweepTween.stop();
        sweepLine.destroy();
        scannerGraphics.destroy();
        msgTimer.destroy();
        overlay.destroy();
      }
    };
  }

  private showRewardModal(victory: 'Attacker' | 'Defender'): void {
    if (this.rewardModalContainer) {
      this.rewardModalContainer.destroy();
    }
    const width = this.scale.width;
    const height = this.scale.height;

    this.rewardModalContainer = this.add.container(0, 0).setDepth(40);

    const backdrop = this.add.rectangle(width / 2, height / 2, width, height, 0x07090e, 0.85)
      .setInteractive();
    this.rewardModalContainer.add(backdrop);

    const panel = this.add.rectangle(width / 2, height / 2, 420, 320, 0x161a22)
      .setStrokeStyle(2, 0xffd166);
    this.rewardModalContainer.add(panel);

    const titleText = victory === 'Attacker' ? '🏆 ATTACKER VICTORY' : '🛡️ DEFENDER DEFENSE SECURED';
    const titleColor = victory === 'Attacker' ? '#ffd166' : '#00f0ff';

    const title = this.add.text(width / 2, height / 2 - 110, titleText, {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '22px',
      color: titleColor,
      stroke: '#000000',
      strokeThickness: 5,
    }).setOrigin(0.5);
    this.rewardModalContainer.add(title);

    const banner = this.add.text(width / 2, height / 2 - 70, 'Faction Match Outcome Rewards', {
      fontFamily: 'Arial, sans-serif',
      fontSize: '13px',
      color: '#a0aab2',
    }).setOrigin(0.5);
    this.rewardModalContainer.add(banner);

    const targetGold = victory === 'Attacker' ? 150 : 75;
    const targetShards = victory === 'Attacker' ? 12 : 5;

    const goldLabel = this.add.text(width / 2, height / 2 - 20, '+0 Gold', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '18px',
      color: '#ffb703',
    }).setOrigin(0.5);
    this.rewardModalContainer.add(goldLabel);

    const shardsLabel = this.add.text(width / 2, height / 2 + 20, '+0 Skill Shards', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '18px',
      color: '#02c39a',
    }).setOrigin(0.5);
    this.rewardModalContainer.add(shardsLabel);

    const levelText = this.add.text(width / 2, height / 2 + 60, 'Level Up! Progress Secured', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '14px',
      color: '#ffd166',
    }).setOrigin(0.5).setAlpha(0);
    this.rewardModalContainer.add(levelText);

    const ledger = { gold: 0, shards: 0 };
    this.tweens.add({
      targets: ledger,
      gold: targetGold,
      shards: targetShards,
      duration: 1500,
      ease: 'Quad.easeOut',
      onUpdate: () => {
        goldLabel.setText(`+${Math.floor(ledger.gold)} Gold`);
        shardsLabel.setText(`+${Math.floor(ledger.shards)} Skill Shards`);
      },
      onComplete: () => {
        this.tweens.add({
          targets: levelText,
          alpha: 1,
          scale: 1.1,
          yoyo: true,
          duration: 300,
        });
      }
    });

    const closeBtn = this.add.rectangle(width / 2, height / 2 + 115, 240, 40, 0xff4500)
      .setInteractive({ useHandCursor: true });
    const closeTxt = this.add.text(width / 2, height / 2 + 115, 'Close & Return to Blueprint', {
      fontFamily: 'Arial Black, Arial, sans-serif',
      fontSize: '13px',
      color: '#ffffff',
    }).setOrigin(0.5);

    closeBtn.on('pointerover', () => closeBtn.setFillStyle(0xff6a00));
    closeBtn.on('pointerout', () => closeBtn.setFillStyle(0xff4500));
    closeBtn.on('pointerdown', () => {
      this.rewardModalContainer?.destroy();
      this.rewardModalContainer = null;
      this.clearSwarmAnimation();
      this.buildGrid();
    });

    this.rewardModalContainer.add(closeBtn);
    this.rewardModalContainer.add(closeTxt);
  }


  override update(_time: number, delta: number): void {
    if (this.replayPlaying && this.replayData) {
      this.replayAccumulator += delta;

      let progress = this.replayAccumulator / this.REPLAY_TICK_DURATION;

      if (progress >= 1) {
        this.advanceReplayFrame();
        this.replayAccumulator -= this.REPLAY_TICK_DURATION;
        progress = this.replayAccumulator / this.REPLAY_TICK_DURATION;
      }

      const clampedProgress = Phaser.Math.Clamp(progress, 0, 1);
      const easeProgress = Phaser.Math.Easing.Sine.InOut(clampedProgress);

      this.activeSwarmNodes.forEach(node => {
        const tX = Math.round(Phaser.Math.Linear(node.startX, node.targetX, easeProgress));
        const tY = Math.round(Phaser.Math.Linear(node.startY, node.targetY, easeProgress));
        node.sprite.container.setPosition(tX, tY);

        if (node.startScale !== node.targetScale) {
           // Basic Yoyo imitation if target is > 1
           if (node.targetScale > 1) {
              const half = Phaser.Math.Easing.Back.Out(Math.min(clampedProgress * 2, 1));
              const half2 = Math.max(0, (clampedProgress - 0.5) * 2);
              const scale = node.startScale + ((node.targetScale - node.startScale) * half) - ((node.targetScale - 1) * half2);
              node.sprite.container.setScale(scale);
           } else {
              const easeScale = Phaser.Math.Easing.Back.Out(clampedProgress);
              node.sprite.container.setScale(Phaser.Math.Linear(node.startScale, node.targetScale, easeScale));
           }
        }

        if (node.startAlpha !== node.targetAlpha) {
           node.sprite.container.setAlpha(Phaser.Math.Linear(node.startAlpha, node.targetAlpha, clampedProgress));
           if (node.isFadingOut && clampedProgress >= 0.95) {
             node.sprite.container.setVisible(false);
           }
        }
      });
    }
  }

  shutdown(): void {
    this.clearSwarmAnimation();
    if (this.game?.canvas && this.canvasClickListener) {
      this.game.canvas.removeEventListener('click', this.canvasClickListener);
    }
  }
}

