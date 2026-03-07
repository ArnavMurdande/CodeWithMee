import React from 'react';
import { Link } from 'react-router-dom';
import './ProfileDropdown.css';

const ProfileDropdown = ({ onLogout }) => {
  return (
    <div className="profile-dropdown">
      <ul>
        <li><Link to="/profile">Profile Settings</Link></li>
        <li><Link to="/settings">Settings</Link></li>
        <li className="dropdown-divider"></li>
        <li><button onClick={onLogout}>Logout</button></li>
      </ul>
    </div>
  );
};

export default ProfileDropdown;
