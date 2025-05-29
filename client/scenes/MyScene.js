import Phaser from "phaser";

import Strawberry from '../entities/Strawberry'; // Adjust path as needed

export default class MyScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MyScene' });

    this.isDragging = false;
    this.prevPointerPos = new Phaser.Math.Vector2();
    this.dragVelocity = new Phaser.Math.Vector2();
    this.dragDirection = new Phaser.Math.Vector2();
    this.dragged = false;
    this.nomnom = null;

    this.circleDebug1 = null;
    this.circleDebug2 = null;

    this.circle1 = null;
    this.circle2 = null;

    this.strawberries = null;
    this.lineGraphics = null;
  }

  preload() {
    this.load.image('nomnom', '/assets/nomnom.png');
    this.load.image('strawberry', '/assets/strawberry.png');
    this.load.image('dust', '/assets/dust.png');
  }

  create() {
    const gridSize = 100; // 200 x 200
    const cellSize = 100; // each cell is 100x100

    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0xcccccc, 1);

    for (let i = 0; i <= gridSize; i++) {
      // Vertical lines
      graphics.moveTo(i * cellSize, 0);
      graphics.lineTo(i * cellSize, gridSize * cellSize);

      // Horizontal lines
      graphics.moveTo(0, i * cellSize);
      graphics.lineTo(gridSize * cellSize, i * cellSize);
    }

    graphics.strokePath();

    this.strawberries = [
      new Strawberry(this, 2000, 300),
      new Strawberry(this, 500, 1000),
      new Strawberry(this, 150, 180),
      new Strawberry(this, 3000, 450),
      new Strawberry(this, 2500, 800),
      new Strawberry(this, 1500, 250),
    ];

    const nomScale = 0.5;
    this.nomnom = this.add.image(this.scale.width / 2, this.scale.height / 2, 'nomnom').setScale(nomScale).setScrollFactor(0);

    const radius = 50;

    this.circle1 = new Phaser.Geom.Circle(150, 180, radius);

    // Circle 1 at world position (0, 0)
    this.circleDebug1 = this.add.circle(150, 180, radius, 0xff0000);
    this.circleDebug1.setVisible(false);

    // Circle 2 at screen center, fixed to screen (no scroll)
    this.circleDebug2 = this.add.circle(this.scale.width / 2, this.scale.height / 2, radius, 0x00ff00);
    this.circleDebug2.setScrollFactor(0); // Stays fixed to screen
    this.circleDebug2.setVisible(false);
    if (!this.nomnom.flipX) {
      this.circleDebug2.setPosition(this.scale.width / 2.3, this.scale.height / 2);
    } else {
      this.circleDebug2.setPosition(this.scale.width / 1.67, this.scale.height / 2);
    }

    this.circle2 = new Phaser.Geom.Circle(this.circleDebug2.x, this.circleDebug2.y, radius);


    // Enable camera to be moveable
    //this.cameras.main.setBounds(0, 0, 2000, 2000); // Example large world bounds

    // Pointer down: start dragging
    this.input.on('pointerdown', (pointer) => {
      this.isDragging = true;
      this.prevPointerPos.set(pointer.x, pointer.y);
      this.dragVelocity.set(0, 0); // Stop momentum
    });

    // Pointer up: stop dragging
    this.input.on('pointerup', () => {
      this.isDragging = false;

      // clamp the drag velocity
      const maxVelocity = 25; // You can adjust this value for feel
      if (this.dragVelocity.length() > maxVelocity) {
        this.dragVelocity.setLength(maxVelocity);
      }

      if (!this.dragged) {
        // Kill any tweens affecting this image
        this.tweens.killTweensOf(this.nomnom);

        // Reset scale to original
        this.nomnom.setScale(nomScale);

        // Start the new tween
        this.tweens.add({
            targets: this.nomnom,
            scale: nomScale + .1,
            duration: 50,
            yoyo: true,
            ease: 'Quad.easeInOut'
        });


        // Convert circle2 (screen-space) to world-space
        // const worldX = this.cameras.main.scrollX + this.circle2.x;
        // const worldY = this.cameras.main.scrollY + this.circle2.y;
        //
        // const dx = this.circle1.x - worldX;
        // const dy = this.circle1.y - worldY;
        // const distance = Math.sqrt(dx * dx + dy * dy);
        //
        // // intersection?
        // if (distance <= this.circle1.radius + this.circle2.radius) {
        // }

        const worldPoint = this.cameras.main.getWorldPoint(this.scale.width / 2, this.scale.height / 2);
        const centerCircle = new Phaser.Geom.Circle(worldPoint.x, worldPoint.y, 50); // radius can be adjusted

        let shake = false;

        this.strawberries = this.strawberries.filter(strawberry => {
          const hit = Phaser.Geom.Intersects.CircleToCircle(centerCircle, strawberry.hitCircle);
          if (hit) {
            shake = true;
            strawberry.destroy();
          }
          return !hit; // remove from list if destroyed
        });

        if (shake) {
          this.cameras.main.shake(50, 0.005);
        }
      }

      this.dragged = false;

      this.dragDirection.copy(this.dragVelocity);

      // Optional: set world bounds to match grid
      //this.cameras.main.setBounds(0, 0, gridSize * cellSize, gridSize * cellSize);
    });
  }

  update(time, delta) {
    const dt = delta / 16.67; // Frame-rate normalization
    const pointer = this.input.activePointer;
    const deceleration = 0.5;

    if (this.isDragging) {
      const currentPos = new Phaser.Math.Vector2(pointer.position.x, pointer.position.y);
      const deltaPos = currentPos.clone().subtract(this.prevPointerPos);

      // todo need to fix the y delta negative value on startup
      //console.log('Previous x: ' + this.prevPointerPos.x + ', Previous y: ' + this.prevPointerPos.y);
      //console.log('Current x: ' + currentPos.x + ', Current y: ' + currentPos.y);
      //if (deltaPos.y >= 800) {
      //  const a = 0;
      //}

      // Move camera by delta (inverse because drag should shift world)
      this.cameras.main.scrollX += deltaPos.x;
      this.cameras.main.scrollY += deltaPos.y;

      this.dragVelocity.copy(deltaPos); // Save for inertia
      this.prevPointerPos.copy(currentPos);

      if (this.dragVelocity.lengthSq() > 0) {
        this.dragged = true;
        if (this.dragVelocity.x > 1) {
          this.nomnom.setFlipX(true);
          this.circleDebug2.setPosition(this.scale.width / 1.67, this.scale.height / 2);
          this.circle2.setPosition(this.circleDebug2.x, this.circleDebug2.y);
        } else if (this.dragVelocity.x < -1) {
          this.nomnom.setFlipX(false);
          this.circleDebug2.setPosition(this.scale.width / 2.5, this.scale.height / 2);
          this.circle2.setPosition(this.circleDebug2.x, this.circleDebug2.y);
        }
      }
    } else if (this.dragVelocity.length() > 0) {
      console.log("Drag released");
      // Apply inertia with damping
      this.cameras.main.scrollX += this.dragVelocity.x;
      this.cameras.main.scrollY += this.dragVelocity.y;

      const opposing = this.dragVelocity.clone().negate().normalize().scale(deceleration); // ~0.5 or similar
      this.dragVelocity.add(opposing);

      const originalDir = this.dragDirection.clone();

      if (this.dragVelocity.dot(originalDir) <= 0) {
          this.dragVelocity.set(0, 0);
      }
    }

    this.strawberries.forEach(strawberry => {
      strawberry.update(this.cameras.main);
    });
  }
}
