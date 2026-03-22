import Phaser from 'phaser';

interface Segment {
    localX: number;
    width: number;
    image: Phaser.GameObjects.RenderTexture;
}

export class FoodItem {
    private scene: Phaser.Scene;
    private textureKey: string;
    private displayObject: Phaser.GameObjects.Image | Phaser.GameObjects.RenderTexture;
    private segments: Segment[] = [];

    public x: number;
    public y: number;
    public width: number;
    public height: number;
    public rotation: number;

    private static textureCounter = 0;

    constructor (
        scene: Phaser.Scene,
        x: number,
        y: number,
        width: number,
        height: number,
        color: number,
        rotation: number = 0
    ) {
        this.scene = scene;
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.rotation = rotation;

        // Generate a unique texture key
        this.textureKey = `food_${FoodItem.textureCounter++}`;

        // Generate solid-color texture
        const g = scene.add.graphics();
        g.fillStyle(color, 1);
        g.fillRect(0, 0, width, height);
        // Add a slightly lighter border for visual pop
        g.lineStyle(3, 0xffffff, 0.4);
        g.strokeRect(1, 1, width - 2, height - 2);
        g.generateTexture(this.textureKey, width, height);
        g.destroy();

        // Create display object
        this.displayObject = scene.add.image(x, y, this.textureKey)
            .setOrigin(0.5, 0.5)
            .setRotation(rotation);
    }

    get centerX (): number {
        return this.x;
    }

    get centerY (): number {
        return this.y;
    }

    setPosition (x: number, y: number): void {
        this.x = x;
        this.y = y;
        if (this.segments.length === 0) {
            this.displayObject.setPosition(x, y);
        } else {
            this.repositionSegments();
        }
    }

    private repositionSegments (): void {
        const foodLeft = this.x - this.width / 2;
        for (const seg of this.segments) {
            const segCenterX = foodLeft + seg.localX + seg.width / 2;
            seg.image.setPosition(segCenterX, this.y);
        }
    }

    applyBite (biteWorldX: number, biteWidth: number): { consumed: number; total: number } {
        // Convert bite world coords to local texture space
        const foodLeft = this.x - this.width / 2;
        const localBiteLeft = biteWorldX - foodLeft;
        const localBiteRight = localBiteLeft + biteWidth;

        // Build current segment list (starts as single full-width segment if no segments yet)
        let currentSegments: Array<{ localX: number; width: number }>;
        if (this.segments.length === 0) {
            currentSegments = [{ localX: 0, width: this.width }];
        } else {
            currentSegments = this.segments.map(s => ({ localX: s.localX, width: s.width }));
        }

        const totalBefore = currentSegments.reduce((sum, s) => sum + s.width, 0);
        const newSegments: Array<{ localX: number; width: number }> = [];

        for (const seg of currentSegments) {
            const segLeft = seg.localX;
            const segRight = seg.localX + seg.width;

            // No overlap
            if (localBiteRight <= segLeft || localBiteLeft >= segRight) {
                newSegments.push({ ...seg });
                continue;
            }

            // Bite fully contains segment — consumed
            if (localBiteLeft <= segLeft && localBiteRight >= segRight) {
                continue;
            }

            // Bite overlaps left edge only
            if (localBiteLeft <= segLeft && localBiteRight < segRight) {
                newSegments.push({ localX: localBiteRight, width: segRight - localBiteRight });
                continue;
            }

            // Bite overlaps right edge only
            if (localBiteLeft > segLeft && localBiteRight >= segRight) {
                newSegments.push({ localX: segLeft, width: localBiteLeft - segLeft });
                continue;
            }

            // Bite is interior — split into two
            newSegments.push({ localX: segLeft, width: localBiteLeft - segLeft });
            newSegments.push({ localX: localBiteRight, width: segRight - localBiteRight });
        }

        // Filter out sub-pixel segments — a zero-dimension RT causes a WebGL framebuffer error.
        const validSegments = newSegments.filter(s => s.width >= 1);

        const totalAfter = validSegments.reduce((sum, s) => sum + s.width, 0);
        const consumed = totalBefore - totalAfter;

        // Hide the current display object
        this.displayObject.setVisible(false);

        // Destroy existing segment images
        for (const seg of this.segments) {
            seg.image.destroy();
        }
        this.segments = [];

        // Create a per-segment RenderTexture of exact segment dimensions.
        // Draw the source texture offset so only [localX .. localX+width] is visible.
        for (const seg of validSegments) {
            const segCenterX = foodLeft + seg.localX + seg.width / 2;

            const segRT = this.scene.add.renderTexture(segCenterX, this.y, seg.width, this.height)
                .setOrigin(0.5, 0.5)
                .setRotation(this.rotation);

            const tmp = this.scene.add.image(0, 0, this.textureKey).setOrigin(0, 0);
            segRT.draw(tmp, -seg.localX, 0);
            tmp.destroy();

            this.segments.push({ localX: seg.localX, width: seg.width, image: segRT });
        }

        return { consumed, total: totalBefore };
    }

    tweenMerge (tweens: Phaser.Tweens.TweenManager, onComplete: () => void): void {
        if (this.segments.length === 0) {
            onComplete();
            return;
        }

        // Compute total packed width
        const totalWidth = this.segments.reduce((sum, s) => sum + s.width, 0);
        // Center the packed result around this.x
        const packLeft = this.x - totalWidth / 2;

        // Compute target x for each segment
        let cursor = packLeft;
        const targets: Array<{ seg: Segment; targetX: number }> = [];
        for (const seg of this.segments) {
            const targetX = cursor + seg.width / 2;
            targets.push({ seg, targetX });
            cursor += seg.width;
        }

        let completed = 0;
        for (const { seg, targetX } of targets) {
            tweens.add({
                targets: seg.image,
                x: targetX,
                duration: 300,
                ease: 'Quad.easeOut',
                onComplete: () => {
                    completed++;
                    if (completed === targets.length) {
                        this.rebake(totalWidth, onComplete);
                    }
                },
            });
        }
    }

    private rebake (totalWidth: number, onComplete: () => void): void {
        const rt = this.scene.add.renderTexture(this.x, this.y, Math.max(1, totalWidth), this.height)
            .setOrigin(0.5, 0.5)
            .setRotation(this.rotation);

        // Each segment is already a correctly-sized RT. Draw them packed left-to-right.
        let cursor = 0;
        for (const seg of this.segments) {
            // rt.draw(obj, x, y) places the object's top-left at (x, y) in RT local space.
            // seg.image has origin (0.5, 0.5), so pass the center coords within the RT.
            rt.draw(seg.image, cursor + seg.width / 2, this.height / 2);
            cursor += seg.width;
        }

        for (const seg of this.segments) {
            seg.image.destroy();
        }
        this.segments = [];

        this.displayObject.destroy();
        if (this.scene.textures.exists(this.textureKey)) {
            this.scene.textures.remove(this.textureKey);
        }

        // Save RT content as a named texture so subsequent bites can draw from it.
        // saveTexture sets _saved=true, preventing the texture from being destroyed with the RT.
        this.textureKey = `food_${FoodItem.textureCounter++}`;
        rt.saveTexture(this.textureKey);

        this.displayObject = rt;
        this.width = totalWidth;

        onComplete();
    }

    isEmpty (): boolean {
        if (this.segments.length > 0) {
            return this.segments.every(s => s.width < 1);
        }
        return this.width < 1;
    }

    destroy (): void {
        for (const seg of this.segments) {
            seg.image.destroy();
        }
        this.segments = [];
        this.displayObject.destroy();
        if (this.scene.textures.exists(this.textureKey)) {
            this.scene.textures.remove(this.textureKey);
        }
    }
}
