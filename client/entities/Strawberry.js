// Strawberry.js
import Phaser from 'phaser';

export default class Strawberry extends Phaser.Physics.Arcade.Sprite {
  constructor(scene, x, y, texture = 'strawberry') {
    super(scene, x, y, texture);

    scene.add.existing(this);
    scene.physics.add.existing(this, true);

    this.setScale(0.5);
    this.setOrigin(0.5, 0.5);

    this.hitCircle = new Phaser.Geom.Circle(this.x, this.y, 40); // Adjust radius as needed

    // Create arrow indicator
    this.arrow = scene.add.triangle(0, 0, 0, 16, 8, 0, 16, 16, 0xff0000);
    this.arrow.setAlpha(0);
    this.arrow.setDepth(1000); // Always on top

    this.arrowTargetAlpha = 0;
    this.arrowTween = null;

    this.pulseTween = scene.tweens.add({
      targets: this.arrow,
      scale: { from: 1, to: 1.3 },
      yoyo: true,
      repeat: -1,
      duration: 500,
      ease: 'Sine.easeInOut',
      paused: true // Start paused
    });

  }

  update(camera) {
    this.hitCircle.setPosition(this.x, this.y);

    const cam = camera;
    const screenCenter = new Phaser.Math.Vector2(cam.midPoint.x, cam.midPoint.y);
    const worldPos = new Phaser.Math.Vector2(this.x, this.y);

    const inView = cam.worldView.contains(this.x, this.y);

    // Pulse visual
    if (inView) {
      this.pulseTween.pause();
    } else {
      this.pulseTween.resume();
    }

    // Arrow visibility tweening logic
    const newTargetAlpha = inView ? 0 : 1;
    if (this.arrowTargetAlpha !== newTargetAlpha) {
      this.arrowTargetAlpha = newTargetAlpha;

      if (this.arrowTween) this.arrowTween.stop();

      this.arrowTween = this.scene.tweens.add({
        targets: this.arrow,
        alpha: newTargetAlpha,
        duration: 300,
        ease: 'Quad.easeInOut'
      });
    }

    if (!inView) {
      const direction = worldPos.clone().subtract(screenCenter).normalize();

      // Clamp arrow to screen bounds
      const edgeBuffer = 20;
      const arrowPos = screenCenter.clone().add(direction.clone().scale(300)); // Distance from center

      arrowPos.x = Phaser.Math.Clamp(arrowPos.x, cam.scrollX + edgeBuffer, cam.scrollX + cam.width - edgeBuffer);
      arrowPos.y = Phaser.Math.Clamp(arrowPos.y, cam.scrollY + edgeBuffer, cam.scrollY + cam.height - edgeBuffer);

      this.arrow.setPosition(arrowPos.x, arrowPos.y);
      this.arrow.setRotation(direction.angle() + Phaser.Math.DegToRad(90));
    }
  }

  destroy(fromScene) {
    this.arrow.destroy();
    super.destroy(fromScene);
  }
}
