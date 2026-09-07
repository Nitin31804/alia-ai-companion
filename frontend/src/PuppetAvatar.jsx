import React from 'react';
import './PuppetAvatar.css';

export default function PuppetAvatar({ isSpeaking, emotion = 'neutral', action = 'idle' }) {
  
  let animationClass = 'breathing-idle';
  if (isSpeaking) {
    animationClass = 'talking-bounce';
  } else if (action === 'wave') {
    animationClass = 'wave-action';
  }

  // Subtle CSS filters based on emotion
  let filterStyle = {};
  if (emotion === 'happy') {
    filterStyle = { filter: 'brightness(1.1) contrast(1.05) drop-shadow(0 0 20px rgba(255, 255, 255, 0.4))' };
  } else if (emotion === 'sad') {
    filterStyle = { filter: 'brightness(0.9) grayscale(20%)' };
  } else if (emotion === 'angry') {
    filterStyle = { filter: 'contrast(1.2) hue-rotate(-10deg) drop-shadow(0 0 20px rgba(255, 0, 0, 0.2))' };
  }

  return (
    <div className="anime-character-stage">
      <img 
        src="/elara_new.jpg" 
        alt="Anime Companion" 
        className={`anime-sprite ${animationClass}`} 
        style={filterStyle}
      />
    </div>
  );
}
