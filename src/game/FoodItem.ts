import Phaser from 'phaser';
import { bakeOutlineTexture } from './OutlineTextureBuilder';

interface Segment {
    localX: number;
    width: number;
    image: Phaser.GameObjects.Image | Phaser.GameObjects.RenderTexture;
    rawTexKey: string; // unbordered slice texture — used by rebake() to avoid border-on-border
    leftBorder: boolean;  // false when this edge was created by a bite cut
    rightBorder: boolean;
}

export class FoodItem {
    private scene: Phaser.Scene;
    // rawKey: unbordered content texture — used for segment drawing in applyBite.
    // After the first rebake it converges with textureKey (both point to the rebaked RT).
    private rawKey: string;
    // textureKey: the texture currently used for display.
    // Initially the bordered version; after the first rebake the plain rebaked RT.
    private textureKey: string;
    private displayObject: Phaser.GameObjects.Image | Phaser.GameObjects.RenderTexture;
    private segments: Segment[] = [];

    public x: number;
    public y: number;
    public width: number;
    public height: number;
    public rotation: number;

    private leftBorder = true;
    private rightBorder = true;
    private _consumed = false; // true when applyBite leaves no surviving segments

    private static textureCounter = 0;
    private static readonly STICKER_BORDER = 12;

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

        // Generate the raw (unbordered) content texture
        this.rawKey = `food_raw_${FoodItem.textureCounter}`;
        const g = scene.add.graphics();
        g.fillStyle(color, 1);
        g.fillRect(0, 0, width, height);
        g.generateTexture(this.rawKey, width, height);
        g.destroy();

        // Bake the white sticker border via the WebGL outline shader.
        // Output is (width + 2*BORDER) × (height + 2*BORDER).
        this.textureKey = `food_${FoodItem.textureCounter++}`;
        try {
            bakeOutlineTexture(scene, this.rawKey, FoodItem.STICKER_BORDER, this.textureKey);
        } catch (e) {
            console.error('OutlineTextureBuilder failed — falling back to raw texture:', e);
            this.textureKey = this.rawKey;
        }

        // Create display object using the bordered texture
        this.displayObject = scene.add.image(x, y, this.textureKey)
            .setOrigin(0.5, 0.5)
            .setRotation(rotation);
    }

    get centerX (): number {
        return this.x;
    }

    /** Rendered width including the sticker border on left and right. */
    get displayWidth (): number {
        return this.width + FoodItem.STICKER_BORDER * 2;
    }

    /** Rendered height including the sticker border on top and bottom. */
    get displayHeight (): number {
        return this.height + FoodItem.STICKER_BORDER * 2;
    }

    /** Axis-aligned bounding box width of the rotated display object (border included). */
    get aabbWidth (): number {
        const cos = Math.abs(Math.cos(this.rotation));
        const sin = Math.abs(Math.sin(this.rotation));
        return this.displayWidth * cos + this.displayHeight * sin;
    }

    /** Axis-aligned bounding box height of the rotated display object (border included). */
    get aabbHeight (): number {
        const cos = Math.abs(Math.cos(this.rotation));
        const sin = Math.abs(Math.sin(this.rotation));
        return this.displayWidth * sin + this.displayHeight * cos;
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
        type SegSpec = { localX: number; width: number; leftBorder: boolean; rightBorder: boolean };
        let currentSegments: SegSpec[];
        if (this.segments.length === 0) {
            currentSegments = [{ localX: 0, width: this.width, leftBorder: this.leftBorder, rightBorder: this.rightBorder }];
        } else {
            currentSegments = this.segments.map(s => ({ localX: s.localX, width: s.width, leftBorder: s.leftBorder, rightBorder: s.rightBorder }));
        }

        const totalBefore = currentSegments.reduce((sum, s) => sum + s.width, 0);
        const newSegments: SegSpec[] = [];

        for (const seg of currentSegments) {
            const segLeft = seg.localX;
            const segRight = seg.localX + seg.width;

            // No overlap — inherit edges unchanged
            if (localBiteRight <= segLeft || localBiteLeft >= segRight) {
                newSegments.push({ ...seg });
                continue;
            }

            // Bite fully contains segment — consumed
            if (localBiteLeft <= segLeft && localBiteRight >= segRight) {
                continue;
            }

            // Bite overlaps left edge only — right piece, left side is now a cut
            if (localBiteLeft <= segLeft && localBiteRight < segRight) {
                newSegments.push({ localX: localBiteRight, width: segRight - localBiteRight, leftBorder: false, rightBorder: seg.rightBorder });
                continue;
            }

            // Bite overlaps right edge only — left piece, right side is now a cut
            if (localBiteLeft > segLeft && localBiteRight >= segRight) {
                newSegments.push({ localX: segLeft, width: localBiteLeft - segLeft, leftBorder: seg.leftBorder, rightBorder: false });
                continue;
            }

            // Bite is interior — left piece keeps original left; right piece keeps original right; both inner edges are cuts
            newSegments.push({ localX: segLeft, width: localBiteLeft - segLeft, leftBorder: seg.leftBorder, rightBorder: false });
            newSegments.push({ localX: localBiteRight, width: segRight - localBiteRight, leftBorder: false, rightBorder: seg.rightBorder });
        }

        // Filter out sub-pixel segments — a zero-dimension RT causes a WebGL framebuffer error.
        const validSegments = newSegments.filter(s => s.width >= 1);

        const totalAfter = validSegments.reduce((sum, s) => sum + s.width, 0);
        const consumed = totalBefore - totalAfter;

        if (validSegments.length === 0) {
            this._consumed = true;
        }

        // Hide the current display object
        this.displayObject.setVisible(false);

        // Destroy existing segment images and their raw textures
        for (const seg of this.segments) {
            seg.image.destroy();
            if (this.scene.textures.exists(seg.rawTexKey)) {
                this.scene.textures.remove(seg.rawTexKey);
            }
        }
        this.segments = [];

        // Create a per-segment RenderTexture of exact segment dimensions.
        // Draw the source texture offset so only [localX .. localX+width] is visible.
        for (const seg of validSegments) {
            const segCenterX = foodLeft + seg.localX + seg.width / 2;

            const segRT = this.scene.add.renderTexture(segCenterX, this.y, seg.width, this.height)
                .setOrigin(0.5, 0.5)
                .setRotation(this.rotation);

            // Draw from the raw (unbordered) content texture so segment dimensions
            // and offsets remain consistent with the bite math coordinate system.
            const tmp = this.scene.add.image(0, 0, this.rawKey).setOrigin(0, 0);
            segRT.draw(tmp, -seg.localX, 0);
            tmp.destroy();

            // Save the plain segment content as a texture for use in rebake().
            const segRawKey = `seg_raw_${FoodItem.textureCounter++}`;
            segRT.saveTexture(segRawKey);

            // Bake the sticker border onto the segment, suppressing cut edges.
            const segBorderedKey = `seg_${FoodItem.textureCounter++}`;
            let segImage: Phaser.GameObjects.Image | Phaser.GameObjects.RenderTexture;
            try {
                bakeOutlineTexture(this.scene, segRawKey, FoodItem.STICKER_BORDER, segBorderedKey, {
                    left: seg.leftBorder,
                    right: seg.rightBorder,
                });
                segRT.destroy();
                segImage = this.scene.add.image(segCenterX, this.y, segBorderedKey)
                    .setOrigin(0.5, 0.5)
                    .setRotation(this.rotation);
            } catch (e) {
                segImage = segRT; // fall back to plain RT
            }

            this.segments.push({ localX: seg.localX, width: seg.width, image: segImage, rawTexKey: segRawKey, leftBorder: seg.leftBorder, rightBorder: seg.rightBorder });
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
        // Derive edge state from the outermost surviving segments.
        const mergedLeftBorder = this.segments[0]?.leftBorder ?? true;
        const mergedRightBorder = this.segments[this.segments.length - 1]?.rightBorder ?? true;

        const rt = this.scene.add.renderTexture(this.x, this.y, Math.max(1, totalWidth), this.height)
            .setOrigin(0.5, 0.5)
            .setRotation(this.rotation);

        // Draw each segment's unbordered slice (rawTexKey) into the merged RT.
        // Using rawTexKey avoids baking the border into the content, which would
        // produce a border-on-border artifact when the merged piece is re-outlined.
        let cursor = 0;
        for (const seg of this.segments) {
            const rawImg = this.scene.add.image(0, 0, seg.rawTexKey).setOrigin(0, 0);
            rt.draw(rawImg, cursor, 0);
            rawImg.destroy();
            cursor += seg.width;
        }

        for (const seg of this.segments) {
            seg.image.destroy();
            if (this.scene.textures.exists(seg.rawTexKey)) {
                this.scene.textures.remove(seg.rawTexKey);
            }
        }
        this.segments = [];

        this.displayObject.destroy();
        if (this.scene.textures.exists(this.textureKey)) {
            this.scene.textures.remove(this.textureKey);
        }
        // Also remove the raw content texture if it is a separate key (first rebake only).
        if (this.rawKey !== this.textureKey && this.scene.textures.exists(this.rawKey)) {
            this.scene.textures.remove(this.rawKey);
        }

        // Save the packed RT content as the new raw (unbordered) texture.
        // rawKey is used for bite-segment drawing; its coordinates must stay unbordered.
        const newKey = `food_${FoodItem.textureCounter++}`;
        rt.saveTexture(newKey);
        this.rawKey = newKey;
        this.width = totalWidth;
        this.leftBorder = mergedLeftBorder;
        this.rightBorder = mergedRightBorder;

        // Re-apply the sticker border, preserving which sides are original vs cut.
        const borderedKey = `food_${FoodItem.textureCounter++}`;
        try {
            bakeOutlineTexture(this.scene, newKey, FoodItem.STICKER_BORDER, borderedKey, {
                left: mergedLeftBorder,
                right: mergedRightBorder,
            });
            rt.destroy();
            this.displayObject = this.scene.add.image(this.x, this.y, borderedKey)
                .setOrigin(0.5, 0.5)
                .setRotation(this.rotation);
            this.textureKey = borderedKey;
        } catch (e) {
            console.error('bakeOutlineTexture failed in rebake — using plain RT:', e);
            this.displayObject = rt;
            this.textureKey = newKey;
        }

        onComplete();
    }

    isEmpty (): boolean {
        if (this._consumed) return true;
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
        // rawKey is a separate texture only before the first rebake
        if (this.rawKey !== this.textureKey && this.scene.textures.exists(this.rawKey)) {
            this.scene.textures.remove(this.rawKey);
        }
    }
}
