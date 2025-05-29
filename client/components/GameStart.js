// components/GameStart.js
import { useEffect, useRef } from 'react';
import Phaser from 'phaser';

import MyScene from "../scenes/MyScene";

const GameStart = () => {
  const gameRef = useRef(null);

  useEffect(() => {
    if (gameRef.current) return;

    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
    };

    setVh();
    window.addEventListener('resize', setVh);

    // Phaser game configuration
    const config = {
      type: Phaser.AUTO,
      physics: {
		    default: "arcade",
		    arcade: {
			    debug: false
		    }
	    },
	    render: {
		    pixelArt: true,
		    antialias: false,
		    antialiasGL: false,
	    },
      // scale: {
      //   mode: Phaser.Scale.FIT, // Scale to fit the parent container
      //   autoCenter: Phaser.Scale.CENTER_BOTH, // Center the game
      //   width: width,
      //   height: height,
      // },
      // scale: {
      //   mode: Phaser.Scale.ENVELOP, // Better for maintaining aspect ratio
      //   autoCenter: Phaser.Scale.CENTER_BOTH,
      //   width: 480,
      //   height: 800
      // },
      scale: {
        mode: Phaser.Scale.FIT, // Better for maintaining aspect ratio
        autoCenter: Phaser.Scale.CENTER_BOTH,
        // width: 480,
        // height: 800
        width: 720,
        height: 1280
      },
      backgroundColor: '#ffffff',
      parent: 'game-container',
      scene: [MyScene]
    };

    // Create Phaser game
    gameRef.current = new Phaser.Game(config);

    // Cleanup on component unmount
    return () => {
      window.removeEventListener('resize', setVh);

      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  return (
    <div
      id="game-container"
      style={{
        width: '100%',
        height: '100vh', // Ensure it takes full screen height
      }}
    />
  );
};

export default GameStart;
