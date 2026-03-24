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

    private biteZone!: Phaser.GameObjects.Graphics;
    private inputBlocked: boolean = true;

    constructor ()
    {
        super('Game');
    }

    create ()
    {
        this.cameras.main.setBackgroundColor('#1a1a2e');
        this.score = 0;
        this.inputBlocked = true;

        this.drawHamster();
        this.drawConveyorBackground();

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

        // Bite zone overlay
        this.biteZone = this.add.graphics();

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
        // this.hungerMeter.deplete(delta);
        // if (this.hungerMeter.getValue() <= 0) {
        //     this.scene.start('GameOver', { score: this.score });
        // }
    }

    // ─── Hamster graphic ───────────────────────────────────────────────────

    private drawHamster (): void {
        const g = this.add.graphics();
        const cx = CANVAS_W / 2;
        const cy = 195;

        // Body
        g.fillStyle(0xc8854a, 1);
        g.fillEllipse(cx, cy + 40, 160, 120);

        // Head
        g.fillStyle(0xc8854a, 1);
        g.fillCircle(cx, cy - 10, 80);

        // Ears
        g.fillStyle(0xc8854a, 1);
        g.fillCircle(cx - 66, cy - 70, 28);
        g.fillCircle(cx + 66, cy - 70, 28);
        g.fillStyle(0xe8a070, 1);
        g.fillCircle(cx - 66, cy - 70, 16);
        g.fillCircle(cx + 66, cy - 70, 16);

        // Eyes
        g.fillStyle(0x222222, 1);
        g.fillCircle(cx - 28, cy - 18, 11);
        g.fillCircle(cx + 28, cy - 18, 11);
        g.fillStyle(0xffffff, 1);
        g.fillCircle(cx - 24, cy - 22, 4);
        g.fillCircle(cx + 32, cy - 22, 4);

        // Nose
        g.fillStyle(0xff9999, 1);
        g.fillEllipse(cx, cy + 4, 18, 12);

        // Cheeks
        g.fillStyle(0xd4956a, 1);
        g.fillCircle(cx - 60, cy + 8, 26);
        g.fillCircle(cx + 60, cy + 8, 26);
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
        const crunch = this.add.text(food.centerX, food.centerY - 60, 'CRUNCH!', {
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

            this.time.delayedCall(NEXT_ITEM_DELAY, () => {
                this.advanceQueue();
            });
        } else {
            food.tweenMerge(this.tweens, () => {
                this.inputBlocked = false;
            });
        }
    }
}
