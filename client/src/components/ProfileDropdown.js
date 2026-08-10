import { Link } from 'react-router-dom';
import './ProfileDropdown.css';

const ProfileDropdown = ({ id, onLogout }) => {
  return (
    <div aria-label="Account" className="profile-dropdown" id={id} role="menu">
      <ul role="none">
        <li role="none">
          <Link role="menuitem" to="/provider">
            Provider Center
          </Link>
        </li>
        <li role="none">
          <Link role="menuitem" to="/profile">
            Profile Settings
          </Link>
        </li>
        <li role="none">
          <Link role="menuitem" to="/settings">
            Settings
          </Link>
        </li>
        <li aria-hidden="true" className="dropdown-divider" role="separator" />
        <li role="none">
          <button onClick={onLogout} role="menuitem" type="button">
            Logout
          </button>
        </li>
      </ul>
    </div>
  );
};

export default ProfileDropdown;
