import dynamic from 'next/dynamic';
import styles from '../styles/Game.module.css';

// Dynamically import the Game component to prevent SSR
const GameStart = dynamic(() => import('../components/GameStart'), { ssr: false });

const Game = () => {
  return (
    <div className={styles.container}>
      <GameStart />
    </div>
  );
};

export default Game;