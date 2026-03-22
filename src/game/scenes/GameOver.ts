import { Scene } from 'phaser';
import { EventBus } from '../EventBus';

export class GameOver extends Scene
{
    private score: number = 0;

    constructor ()
    {
        super('GameOver');
    }

    init (data: { score?: number })
    {
        this.score = data.score ?? 0;
    }

    create ()
    {
        this.cameras.main.setBackgroundColor('#0d0d1a');

        const cx = 270;
        const cy = 480;

        this.add.text(cx, cy - 120, 'GAME OVER', {
            fontFamily: 'Arial Black',
            fontSize: 52,
            color: '#ff4444',
            stroke: '#000000',
            strokeThickness: 8,
            align: 'center',
        }).setOrigin(0.5);

        this.add.text(cx, cy, `Score: ${this.score}`, {
            fontFamily: 'Arial',
            fontSize: 36,
            color: '#ffffff',
            align: 'center',
        }).setOrigin(0.5);

        this.add.text(cx, cy + 100, 'tap to play again', {
            fontFamily: 'Arial',
            fontSize: 22,
            color: '#aaaaaa',
            align: 'center',
        }).setOrigin(0.5);

        this.input.once('pointerdown', () => {
            this.scene.start('MainMenu');
        });

        EventBus.emit('current-scene-ready', this);
    }
}
