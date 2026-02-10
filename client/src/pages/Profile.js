import React, { useState, useEffect, useContext } from 'react';
import axios from 'axios';
import { AuthContext } from '../context/AuthContext';
import './Profile.css';

const Profile = () => {
  const { token, user, setUser } = useContext(AuthContext);
  
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    profilePictureUrl: '',
  });
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (user) {
      let finalProfilePicUrl = user.profilePictureUrl || '';
      // If it's a locally uploaded file, construct the full URL
      if (finalProfilePicUrl && finalProfilePicUrl.startsWith('/uploads')) {
        finalProfilePicUrl = `http://localhost:5001${finalProfilePicUrl}`;
      }
      setFormData({
        username: user.username || '',
        email: user.email || '',
        profilePictureUrl: finalProfilePicUrl,
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
      const res = await axios.put(
        'http://localhost:5001/api/user/me',
        { username: formData.username, email: formData.email },
        { headers: { 'x-auth-token': token } }
      );
      // Update the user in the global context
      setUser(res.data);
      setStatusMessage('Profile updated successfully!');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
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
        const res = await axios.post(
            'http://localhost:5001/api/user/upload-picture',
            uploadData,
            { headers: { 'x-auth-token': token } }
        );
        
        // --- FIX: Immediately update the user in the global context ---
        // This will trigger the useEffect in this component and the Header to update the image.
        setUser(prevUser => ({
          ...prevUser,
          profilePictureUrl: res.data.profilePictureUrl
        }));

        setStatusMessage(res.data.message);
        setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
        const errorMessage = err.response?.data?.message || 'Photo upload failed.';
        setStatusMessage(String(errorMessage));
        setTimeout(() => setStatusMessage(''), 3000);
    }
  };

  return (
    <div className="profile-page-container">
      <div className="profile-card">
        <h2>Profile Settings</h2>
        
        <div className="profile-picture-section">
          <img src={formData.profilePictureUrl || 'https://i.imgur.com/3YQeY9r.png'} alt="Profile" className="profile-picture" />
          <input type="file" id="file-upload" onChange={onFileChange} style={{display: 'none'}} accept="image/*"/>
          <label htmlFor="file-upload" className="upload-button">Change Photo</label>
        </div>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input type="text" id="username" name="username" value={formData.username} onChange={onChange} required />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input type="email" id="email" name="email" value={formData.email} onChange={onChange} required />
          </div>
          <div className="form-group">
             <label>Password</label>
             <button type="button" className="change-password-button">Change Password</button>
          </div>
          
          <button type="submit" className="save-button">Save Changes</button>
        </form>

        {statusMessage && <p className="status-message">{statusMessage}</p>}
      </div>
    </div>
  );
};

export default Profile;