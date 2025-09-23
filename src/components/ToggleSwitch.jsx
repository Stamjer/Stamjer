import React from 'react';
import './ToggleSwitch.css';

const ToggleSwitch = ({ isToggled, onToggle, disabled = false }) => {
  return (
    <label className="toggle-switch">
      <input 
        type="checkbox" 
        checked={isToggled} 
        onChange={onToggle} 
        disabled={disabled}
      />
      <span className="slider round"></span>
    </label>
  );
};

export default ToggleSwitch;
