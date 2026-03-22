import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

export class MainMenu extends Scene
{
    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        this.cameras.main.setBackgroundColor('#1a1a2e');

        const cx = 270;

        // Hamster body
        const g = this.add.graphics();

        // Head
        g.fillStyle(0xc8854a, 1);
        g.fillCircle(cx, 340, 90);

        // Ears
        g.fillCircle(cx - 75, 275, 30);
        g.fillCircle(cx + 75, 275, 30);

        // Inner ear
        g.fillStyle(0xe8a070, 1);
        g.fillCircle(cx - 75, 275, 18);
        g.fillCircle(cx + 75, 275, 18);

        // Eyes
        g.fillStyle(0x222222, 1);
        g.fillCircle(cx - 32, 325, 12);
        g.fillCircle(cx + 32, 325, 12);

        // Eye shine
        g.fillStyle(0xffffff, 1);
        g.fillCircle(cx - 28, 320, 5);
        g.fillCircle(cx + 36, 320, 5);

        // Nose
        g.fillStyle(0xff9999, 1);
        g.fillEllipse(cx, 358, 20, 14);

        // Cheek pouches
        g.fillStyle(0xd4956a, 1);
        g.fillCircle(cx - 68, 355, 28);
        g.fillCircle(cx + 68, 355, 28);

        // Title
        this.add.text(cx, 480, 'HAMSTER CRUNCH', {
            fontFamily: 'Arial Black',
            fontSize: 36,
            color: '#ffffff',
            stroke: '#000000',
            strokeThickness: 6,
            align: 'center',
        }).setOrigin(0.5);

        this.add.text(cx, 540, 'tap anywhere to play', {
            fontFamily: 'Arial',
            fontSize: 22,
            color: '#aaaaaa',
            align: 'center',
        }).setOrigin(0.5);

        this.input.once('pointerdown', () => {
            this.scene.start('Game');
        });

        EventBus.emit('current-scene-ready', this);
    }
}
