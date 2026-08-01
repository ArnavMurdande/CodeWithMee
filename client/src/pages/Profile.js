import { useState, useEffect, useContext } from 'react';
import defaultAvatarUrl from '../assets/images/default-avatar.svg';
import axios, { assetUrl } from '../lib/api';
import { AuthContext } from '../context/AuthContext';

const Profile = () => {
  const { requestPasswordReset, user, setUser } = useContext(AuthContext);

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    profilePictureUrl: '',
  });
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (user) {
      const rawPicture = user.avatarUrl || user.profilePictureUrl || '';
      const picUrl = rawPicture.startsWith('/uploads') ? assetUrl(rawPicture) : rawPicture;

      setFormData({
        username: user.username || user.displayName || '',
        email: user.email || '',
        profilePictureUrl: picUrl,
      });
    }
  }, [user]);

  const onChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setStatusMessage('Updating...');
    try {
      const res = await axios.put('/api/user/me', { username: formData.username });
      setUser(res.data);
      setStatusMessage('Profile updated successfully!');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch {
      setStatusMessage('Error updating profile.');
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const onFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const uploadData = new FormData();
    uploadData.append('profilePicture', file);

    setStatusMessage('Uploading photo...');
    try {
      const res = await axios.post('/api/user/upload-picture', uploadData);
      setUser((prevUser) => ({
        ...prevUser,
        avatarUrl: res.data.profilePictureUrl,
        profilePictureUrl: res.data.profilePictureUrl,
      }));

      setStatusMessage(res.data.message);
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      const errorMessage = err.response?.data?.message || 'Photo upload failed.';
      setStatusMessage(String(errorMessage));
      setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  const requestPasswordChange = async () => {
    setStatusMessage('Requesting password-reset instructions…');
    try {
      await requestPasswordReset(user.email);
      setStatusMessage('If eligible, password-reset instructions have been queued.');
    } catch {
      setStatusMessage('Password-reset instructions could not be requested.');
    }
  };

  return (
    <div className="profile-page-container">
      <div className="profile-card">
        <h2>Profile Settings</h2>

        <div className="profile-picture-section">
          <img
            src={formData.profilePictureUrl || defaultAvatarUrl}
            alt="Profile"
            className="profile-picture"
          />
          <input
            type="file"
            id="file-upload"
            onChange={onFileChange}
            style={{ display: 'none' }}
            accept="image/*"
          />
          <label htmlFor="file-upload" className="upload-button">
            Change Photo
          </label>
        </div>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={onChange}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" value={formData.email} readOnly />
          </div>
          <div className="form-group">
            <span className="form-label">Password</span>
            <button
              type="button"
              className="change-password-button"
              onClick={requestPasswordChange}
            >
              Change Password
            </button>
          </div>

          <button type="submit" className="save-button">
            Save Changes
          </button>
        </form>

        {statusMessage && (
          <p className="status-message" role="status">
            {statusMessage}
          </p>
        )}
      </div>
    </div>
  );
};

export default Profile;
