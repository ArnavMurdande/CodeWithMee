'use strict';

function createRoadmapService({ repository }) {
  if (!repository) throw new Error('Roadmap repository is required.');

  async function createRoadmap(userId, payload) {
    if (!userId) {
      const error = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
    return repository.createRoadmap(userId, payload);
  }

  async function getRoadmaps(userId) {
    if (!userId) return [];
    return repository.getRoadmaps(userId);
  }

  async function getRoadmapById(userId, roadmapId) {
    if (!userId || !roadmapId) return null;
    return repository.getRoadmapById(userId, roadmapId);
  }

  async function updateTopicProgress(userId, payload) {
    if (!userId) {
      const error = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
    const updated = await repository.updateTopicProgress(userId, payload);
    if (!updated) {
      const error = new Error('Topic or roadmap not found or not owned by user');
      error.status = 404;
      throw error;
    }
    return updated;
  }

  async function deleteRoadmap(userId, roadmapId) {
    if (!userId) {
      const error = new Error('Authentication required');
      error.status = 401;
      throw error;
    }
    const deleted = await repository.deleteRoadmap(userId, roadmapId);
    if (!deleted) {
      const error = new Error('Roadmap not found or not owned by user');
      error.status = 404;
      throw error;
    }
    return true;
  }

  return {
    createRoadmap,
    getRoadmaps,
    getRoadmapById,
    updateTopicProgress,
    deleteRoadmap,
  };
}

module.exports = { createRoadmapService };
