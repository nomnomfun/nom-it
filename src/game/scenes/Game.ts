import { Scene } from 'phaser';
import { EventBus } from '../EventBus';
import { FoodItem } from '../FoodItem';
import { HungerMeter } from '../HungerMeter';

// Layout constants (540×960 portrait canvas)
const CANVAS_W = 540;
const CANVAS_H = 960;

const HUNGER_DRAIN_RATE = 8;   // units/s out of 100
const REFILL_MAX = 35;          // max hunger restored per perfectly precise bite
const NEXT_ITEM_DELAY = 500;    // ms before next item animates in after full consume
const QUEUE_SIZE = 4;           // upcoming items shown in conveyor HUD

const DRAG_ZONE_Y = 700;        // y above which drag is ignored
const BITE_ZONE_PADDING = 4;        // extra px added above/below the food when drawing the bite zone overlay
const BITE_ZONE_DEFAULT_HEIGHT = 100; // fallback height used before activeFood is ready

// Food slot center
const FOOD_CX = CANVAS_W / 2;
const FOOD_CY = 440;

// Hamster sprite
const HAMSTER_CX = CANVAS_W / 2;
const HAMSTER_CY = 200;
const HAMSTER_SCALE = 0.75;

// Hamster hands
const HAND_SPEED = 500;          // px/s — how fast hands slide to/from food
const HAND_SCALE = 0.7;          // 256×256 → ~179×179 rendered
const HAND_ALPHA = 0.6;          // opacity — low enough to see food behind the hands
const HAND_GAP = 25;             // extra px between hand center and food AABB edge
const HAND_DEFAULT_SPREAD = 180; // half-distance between hands when no food is active

// Floating idle animation — all layers share one sine wave; food/hands lag behind
const FLOAT_AMPLITUDE = 3;    // px — shared vertical bob distance
const FLOAT_PERIOD    = 4000;  // ms — full cycle (up + back down)
const FLOAT_LAG_MS    = 600;   // ms — how far food + hands trail behind the hamster

// Bite animation frame durations (ms) — tune these to taste
const BITE_ANIM_IDLE_MS        = 1;
const BITE_ANIM_MOUTH_OPEN_MS  = 50; // held longer for anticipation
const BITE_ANIM_BITE_MS        = 230; // held longer for impact
const BITE_ANIM_INBETWEEN_MS   = 80;

// Conveyor HUD row
const CONVEYOR_Y = 610;
const CONVEYOR_ITEM_HEIGHT = 60;

// Palette of food colors for prototype
const FOOD_COLORS = [0xFF6B35, 0x4CAF50, 0x9C27B0, 0xFF5252, 0x2196F3, 0xFFEB3B, 0xFF4081];

function randomFoodConfig (): { width: number; height: number; color: number; rotation: number } {
    return {
        width: Phaser.Math.Between(180, 320),
        height: Phaser.Math.Between(80, 120),
        color: FOOD_COLORS[Phaser.Math.Between(0, FOOD_COLORS.length - 1)],
        rotation: Phaser.Math.FloatBetween(-0.12, 0.12),
    };
}

export class Game extends Scene
{
    private hungerMeter!: HungerMeter;
    private scoreText!: Phaser.GameObjects.Text;
    private score: number = 0;

    private activeFood: FoodItem | null = null;
    private queue: Array<{ width: number; height: number; color: number; rotation: number }> = [];
    private queueImages: Phaser.GameObjects.Rectangle[] = [];

    private hamsterSprite!: Phaser.GameObjects.Sprite;
    private hamsterBiting = false;
    private handLeft!: Phaser.GameObjects.Sprite;
    private handRight!: Phaser.GameObjects.Sprite;
    private handLeftTarget = { x: 0, y: 0 };
    private handRightTarget = { x: 0, y: 0 };

    private biteZone!: Phaser.GameObjects.Graphics;
    private inputBlocked: boolean = true;

    constructor ()
    {
        super('Game');
    }

    preload ()
    {
        this.load.spritesheet('nomnom', 'assets/nomnom-sheet.png', {
            frameWidth: 512,
            frameHeight: 512,
            spacing: 1,
        });
        this.load.spritesheet('nomnom-hands', 'assets/nomnom-hand-sheet.png', {
            frameWidth: 256,
            frameHeight: 256,
            spacing: 1,
        });
    }

    create ()
    {
        this.cameras.main.setBackgroundColor('#839892');
        this.score = 0;
        this.inputBlocked = true;

        this.drawConveyorBackground();

        // Hamster sprite — starts on frame 0 (idle)
        this.hamsterSprite = this.add.sprite(HAMSTER_CX, HAMSTER_CY, 'nomnom', 0)
            .setScale(HAMSTER_SCALE);

        this.anims.create({
            key: 'bite',
            frames: [
                { key: 'nomnom', frame: 0, duration: BITE_ANIM_IDLE_MS },
                { key: 'nomnom', frame: 1, duration: BITE_ANIM_MOUTH_OPEN_MS },
                { key: 'nomnom', frame: 2, duration: BITE_ANIM_BITE_MS },
                { key: 'nomnom', frame: 3, duration: BITE_ANIM_INBETWEEN_MS },
            ],
            frameRate: 10,
            repeat: 0,
        });

        // Return to idle frame after bite animation completes; float resumes automatically
        this.hamsterSprite.on(
            Phaser.Animations.Events.ANIMATION_COMPLETE,
            () => {
                this.hamsterSprite.setFrame(0);
                this.hamsterBiting = false;
            }
        );

        // HUD
        this.hungerMeter = new HungerMeter(this, 20, 14, CANVAS_W - 40, 32);

        this.scoreText = this.add.text(CANVAS_W - 20, 14, 'Score: 0', {
            fontFamily: 'Arial',
            fontSize: 20,
            color: '#ffffff',
        }).setOrigin(1, 0);

        // Drag zone hint text
        this.add.text(CANVAS_W / 2, DRAG_ZONE_Y + 80, 'drag to set bite width\nrelease to bite', {
            fontFamily: 'Arial',
            fontSize: 18,
            color: '#555577',
            align: 'center',
        }).setOrigin(0.5, 0);

        // Hand sprites — start spread wide (no food active); depth above food
        this.handLeftTarget  = { x: FOOD_CX - HAND_DEFAULT_SPREAD, y: FOOD_CY };
        this.handRightTarget = { x: FOOD_CX + HAND_DEFAULT_SPREAD, y: FOOD_CY };
        this.handLeft = this.add.sprite(this.handLeftTarget.x, this.handLeftTarget.y, 'nomnom-hands', 0)
            .setScale(HAND_SCALE)
            .setDepth(5);
        this.handRight = this.add.sprite(this.handRightTarget.x, this.handRightTarget.y, 'nomnom-hands', 1)
            .setScale(HAND_SCALE)
            .setDepth(5);

        // Bite zone overlay — drawn above hands
        this.biteZone = this.add.graphics().setDepth(10);

        // Seed queue
        for (let i = 0; i < QUEUE_SIZE; i++) {
            this.queue.push(randomFoodConfig());
        }
        this.redrawQueueHUD();

        // Set up drag zone input
        this.input.on('pointerdown', this.onPointerDown, this);
        this.input.on('pointermove', this.onPointerMove, this);
        this.input.on('pointerup', this.onPointerUp, this);

        // Animate first item in
        this.time.delayedCall(200, () => this.advanceQueue());

        EventBus.emit('current-scene-ready', this);
    }

    update (_time: number, delta: number)
    {
        const dt = delta / 1000;
        const TAU_OVER_PERIOD = (2 * Math.PI) / FLOAT_PERIOD;
        const now = this.time.now;

        // Hamster bobs on its own phase; paused during bite
        if (!this.hamsterBiting) {
            this.hamsterSprite.setY(HAMSTER_CY - Math.sin(now * TAU_OVER_PERIOD) * FLOAT_AMPLITUDE);
        }

        // Food + hands sample the same wave but lagged — guaranteed in sync, never drifts
        const foodFloatY = -Math.sin((now - FLOAT_LAG_MS) * TAU_OVER_PERIOD) * FLOAT_AMPLITUDE;
        this.handLeftTarget.y  = FOOD_CY + foodFloatY;
        this.handRightTarget.y = FOOD_CY + foodFloatY;
        if (this.activeFood) {
            this.activeFood.setPosition(FOOD_CX, FOOD_CY + foodFloatY);
        }

        this.moveHandToward(this.handLeft,  this.handLeftTarget,  dt);
        this.moveHandToward(this.handRight, this.handRightTarget, dt);

        // this.hungerMeter.deplete(delta);
        // if (this.hungerMeter.getValue() <= 0) {
        //     this.scene.start('GameOver', { score: this.score });
        // }
    }

    // ─── Conveyor HUD ──────────────────────────────────────────────────────

    private drawConveyorBackground (): void {
        const g = this.add.graphics();
        g.fillStyle(0x11112a, 1);
        g.fillRoundedRect(10, CONVEYOR_Y - 45, CANVAS_W - 20, 100, 12);
        g.lineStyle(1, 0x333355, 1);
        g.strokeRoundedRect(10, CONVEYOR_Y - 45, CANVAS_W - 20, 100, 12);

        this.add.text(CANVAS_W / 2, CONVEYOR_Y - 38, 'UP NEXT', {
            fontFamily: 'Arial',
            fontSize: 13,
            color: '#555577',
        }).setOrigin(0.5, 0);
    }

    private redrawQueueHUD (): void {
        // Destroy old thumbnail rects
        for (const img of this.queueImages) img.destroy();
        this.queueImages = [];

        const slotWidth = (CANVAS_W - 40) / QUEUE_SIZE;
        for (let i = 0; i < this.queue.length; i++) {
            const cfg = this.queue[i];
            const slotCX = 20 + slotWidth * i + slotWidth / 2;

            // Scale thumbnail proportionally (max height = CONVEYOR_ITEM_HEIGHT)
            const scale = CONVEYOR_ITEM_HEIGHT / cfg.height;
            const thumbW = cfg.width * scale;
            const thumbH = cfg.height * scale;

            const rect = this.add.rectangle(slotCX, CONVEYOR_Y + 20, thumbW, thumbH, cfg.color)
                .setRotation(cfg.rotation)
                .setStrokeStyle(1, 0xffffff, 0.4);
            this.queueImages.push(rect);
        }
    }

    // ─── Queue advance ─────────────────────────────────────────────────────

    private advanceQueue (): void {
        if (this.activeFood) {
            this.activeFood.destroy();
            this.activeFood = null;
        }

        if (this.queue.length === 0) {
            this.queue.push(randomFoodConfig());
        }

        const cfg = this.queue.shift()!;
        this.queue.push(randomFoodConfig());
        this.redrawQueueHUD();

        // Spawn food off-screen above, tween it down into the active slot.
        const food = new FoodItem(
            this,
            FOOD_CX,
            FOOD_CY - 300,
            cfg.width,
            cfg.height,
            cfg.color,
            cfg.rotation
        );

        // Tween the food y via a proxy object (FoodItem is not a Phaser GO)
        const proxy = { y: FOOD_CY - 300 };
        this.tweens.add({
            targets: proxy,
            y: FOOD_CY,
            duration: 350,
            ease: 'Back.easeOut',
            onUpdate: () => {
                food.setPosition(FOOD_CX, proxy.y);
            },
            onComplete: () => {
                this.activeFood = food;
                this.inputBlocked = false;
                this.updateHandTargets();
                if (this.input.activePointer.isDown) {
                    this.drawBiteZone(Phaser.Math.Clamp(this.input.activePointer.x, 0, CANVAS_W));
                }
            },
        });
    }

    // ─── Drag / bite interaction ────────────────────────────────────────────

    private onPointerDown (pointer: Phaser.Input.Pointer): void {
        if (pointer.y < DRAG_ZONE_Y) return;
        this.drawBiteZone(Phaser.Math.Clamp(pointer.x, 0, CANVAS_W));
    }

    private onPointerMove (pointer: Phaser.Input.Pointer): void {
        if (!pointer.isDown) return;
        if (pointer.y < DRAG_ZONE_Y && pointer.downY < DRAG_ZONE_Y) return;

        const biteWidth = Phaser.Math.Clamp(pointer.x, 0, CANVAS_W);
        this.drawBiteZone(biteWidth);
    }

    private onPointerUp (pointer: Phaser.Input.Pointer): void {
        if (pointer.downY < DRAG_ZONE_Y) return;

        const biteWidth = Phaser.Math.Clamp(pointer.x, 0, CANVAS_W);
        this.biteZone.clear();

        // Only bite if food is settled in the active slot
        if (this.inputBlocked || !this.activeFood) return;
        if (biteWidth < 2) return; // ignore accidental taps

        this.executeBite(biteWidth);
    }

    private drawBiteZone (biteWidth: number): void {
        this.biteZone.clear();
        if (biteWidth <= 0) return;

        const zoneHeight = this.activeFood ? this.activeFood.aabbHeight : BITE_ZONE_DEFAULT_HEIGHT;
        const left = FOOD_CX - biteWidth / 2;
        const top = FOOD_CY - zoneHeight / 2 - BITE_ZONE_PADDING;
        const height = zoneHeight + BITE_ZONE_PADDING * 2;

        this.biteZone.fillStyle(0xffffff, 0.25);
        this.biteZone.fillRect(left, top, biteWidth, height);
        this.biteZone.lineStyle(2, 0xffffff, 0.8);
        this.biteZone.strokeRect(left, top, biteWidth, height);
    }

    private executeBite (biteWidth: number): void {
        const food = this.activeFood;
        if (!food) return;

        this.inputBlocked = true;
        this.hamsterBiting = true;
        this.hamsterSprite.setY(HAMSTER_CY);
        this.hamsterSprite.play('bite');

        const biteX = food.centerX - biteWidth / 2;
        const { consumed, total } = food.applyBite(biteX, biteWidth);

        const efficiency = Math.min(1, consumed / (biteWidth * food.height));
        this.hungerMeter.refill(efficiency * REFILL_MAX);

        // Camera shake
        this.cameras.main.shake(80, 0.005);

        // White flash over bite area
        const flash = this.add.rectangle(
            food.centerX, food.centerY, biteWidth, food.height, 0xffffff, 0.7
        );
        this.tweens.add({
            targets: flash,
            alpha: 0,
            duration: 150,
            onComplete: () => flash.destroy(),
        });

        // "CRUNCH!" pop
        const crunch = this.add.text(food.centerX, food.centerY - 60, 'NOM!', {
            fontFamily: 'Arial Black',
            fontSize: 28,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 5,
        }).setOrigin(0.5);
        this.tweens.add({
            targets: crunch,
            y: crunch.y - 60,
            alpha: 0,
            duration: 600,
            ease: 'Quad.easeOut',
            onComplete: () => crunch.destroy(),
        });

        if (food.isEmpty()) {
            // Full consume bonus
            const bonus = Math.round(100 + efficiency * 150);
            this.score += bonus;
            this.scoreText.setText(`Score: ${this.score}`);

            this.activeFood = null;
            food.destroy();
            this.updateHandTargets();

            this.time.delayedCall(NEXT_ITEM_DELAY, () => {
                this.advanceQueue();
            });
        } else {
            food.tweenMerge(this.tweens, () => {
                this.inputBlocked = false;
                this.updateHandTargets();
            });
        }
    }

    // ─── Hand helpers ───────────────────────────────────────────────────────

    /** Move a hand sprite toward its target at HAND_SPEED px/s. */
    private moveHandToward (
        hand: Phaser.GameObjects.Sprite,
        target: { x: number; y: number },
        dt: number
    ): void {
        const dx = target.x - hand.x;
        const dy = target.y - hand.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) { hand.setPosition(target.x, target.y); return; }
        const step = HAND_SPEED * dt;
        if (step >= dist) {
            hand.setPosition(target.x, target.y);
        } else {
            hand.setPosition(hand.x + (dx / dist) * step, hand.y + (dy / dist) * step);
        }
    }

    /** Recompute where the hands should be based on the current active food. */
    private updateHandTargets (): void {
        if (!this.activeFood) {
            this.handLeftTarget  = { x: FOOD_CX - HAND_DEFAULT_SPREAD, y: FOOD_CY };
            this.handRightTarget = { x: FOOD_CX + HAND_DEFAULT_SPREAD, y: FOOD_CY };
            // Restore full opacity when no food is active
            this.handLeft.setAlpha(1);
            this.handRight.setAlpha(1);
        } else {
            const halfW = this.activeFood.aabbWidth / 2;
            this.handLeftTarget  = { x: FOOD_CX - halfW - HAND_GAP, y: FOOD_CY };
            this.handRightTarget = { x: FOOD_CX + halfW + HAND_GAP, y: FOOD_CY };
            // Ease-in fade to translucent as hands close in on the food
            this.tweens.add({
                targets: [this.handLeft, this.handRight],
                alpha: HAND_ALPHA,
                duration: 100,
                ease: 'Sine.easeIn',
            });
        }
    }
}
