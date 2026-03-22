import Phaser from 'phaser';

const DRAIN_RATE = 8; // units per second out of 100

export class HungerMeter {
    private scene: Phaser.Scene;
    private graphics: Phaser.GameObjects.Graphics;
    private x: number;
    private y: number;
    private barWidth: number;
    private barHeight: number;
    private value: number = 100;

    constructor (scene: Phaser.Scene, x: number, y: number, barWidth: number, barHeight: number) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.barWidth = barWidth;
        this.barHeight = barHeight;
        this.graphics = scene.add.graphics();
        this.redraw();
    }

    deplete (deltaMs: number): void {
        this.value = Math.max(0, this.value - DRAIN_RATE * deltaMs / 1000);
        this.redraw();
    }

    refill (amount: number): void {
        this.value = Math.min(100, this.value + amount);
        this.redraw();
    }

    getValue (): number {
        return this.value;
    }

    reset (): void {
        this.value = 100;
        this.redraw();
    }

    private redraw (): void {
        this.graphics.clear();

        // Background track
        this.graphics.fillStyle(0x333344, 1);
        this.graphics.fillRoundedRect(this.x, this.y, this.barWidth, this.barHeight, 6);

        // Fill color: green → yellow → red
        const fillColor = this.getFillColor();
        const fillWidth = Math.max(0, (this.value / 100) * (this.barWidth - 4));

        this.graphics.fillStyle(fillColor, 1);
        this.graphics.fillRoundedRect(this.x + 2, this.y + 2, fillWidth, this.barHeight - 4, 4);

        // Border
        this.graphics.lineStyle(2, 0xffffff, 0.5);
        this.graphics.strokeRoundedRect(this.x, this.y, this.barWidth, this.barHeight, 6);
    }

    private getFillColor (): number {
        if (this.value > 60) {
            // Green to yellow
            const t = (this.value - 60) / 40;
            return Phaser.Display.Color.Interpolate.ColorWithColor(
                Phaser.Display.Color.ValueToColor(0xFFEB3B),
                Phaser.Display.Color.ValueToColor(0x4CAF50),
                100,
                Math.round(t * 100)
            ).color;
        } else {
            // Yellow to red
            const t = this.value / 60;
            return Phaser.Display.Color.Interpolate.ColorWithColor(
                Phaser.Display.Color.ValueToColor(0xF44336),
                Phaser.Display.Color.ValueToColor(0xFFEB3B),
                100,
                Math.round(t * 100)
            ).color;
        }
    }
}
