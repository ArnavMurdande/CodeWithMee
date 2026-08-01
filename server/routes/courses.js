const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Enrollment = require('../models/Enrollment');
const CompanyEmployee = require('../models/CompanyEmployee');
const User = require('../models/User');
const authMiddleware = require('../middleware/authMiddleware');
const { createLegacyLogger } = require('../utils/legacyLogger');

const legacyLogger = createLegacyLogger('courses');

// =============================================
//  COMPANY ROUTES (must be before /:id)
// =============================================

function retiredProviderCourseRoute(_request, response) {
  response.status(410).json({
    error: {
      code: 'legacy_provider_course_route_retired',
      replacement: '/api/v1/organizations/:organizationId/courses',
    },
  });
}

router.get('/company/mine', retiredProviderCourseRoute);
router.get('/company/enrollments', retiredProviderCourseRoute);
router.post('/company/create', retiredProviderCourseRoute);
router.put('/company/:courseId', retiredProviderCourseRoute);
router.delete('/company/:courseId', retiredProviderCourseRoute);

// =============================================
//  LEARNER ROUTES (static paths before /:id)
// =============================================

// @route   GET api/courses/learner/enrolled
router.get('/learner/enrolled', authMiddleware, async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ user: req.user.id }).populate({
      path: 'course',
      populate: { path: 'company', select: 'companyName logo' },
    });
    res.json(enrollments);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/courses
router.get('/', authMiddleware, async (req, res) => {
  try {
    const courses = await Course.find({ isActive: true, visibility: 'public' })
      .populate('company', 'companyName logo')
      .sort({ createdAt: -1 });
    res.json(courses);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// @route   GET api/courses/:id  (MUST be LAST among GET routes)
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('company', 'companyName logo');
    if (!course) return res.status(404).json({ msg: 'Course not found' });

    if (course.visibility === 'private') {
      const enrollment = await Enrollment.findOne({ user: req.user.id, course: course._id });
      if (!enrollment) return res.status(403).json({ msg: 'Not enrolled in this private course' });
    }

    const enrollment = await Enrollment.findOne({ user: req.user.id, course: course._id });
    res.json({ course, enrollment });
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// @route   POST api/courses/:id/enroll
router.post('/:id/enroll', authMiddleware, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) return res.status(404).json({ msg: 'Course not found' });

    const { employeeId } = req.body;

    if (course.visibility === 'private') {
      if (!employeeId)
        return res.status(400).json({ msg: 'Employee ID required for private course' });
      const record = await CompanyEmployee.findOne({
        company: course.company,
        employeeId,
        user: req.user.id,
      });
      if (!record)
        return res
          .status(403)
          .json({ msg: 'Unauthorized access. Invalid Employee ID or not assigned to you.' });
    }

    let enrollment = await Enrollment.findOne({ user: req.user.id, course: course._id });
    if (enrollment) return res.status(400).json({ msg: 'Already enrolled in this course' });

    enrollment = new Enrollment({
      user: req.user.id,
      course: course._id,
      company: course.company,
      employeeId: employeeId || null,
    });

    await enrollment.save();

    const user = await User.findById(req.user.id);
    if (user) {
      user.enrolledCourses.push(enrollment._id);
      await user.save();
    }

    res.json({ msg: 'Enrolled successfully', enrollment });
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

// @route   PUT api/courses/:id/progress
router.put('/:id/progress', authMiddleware, async (req, res) => {
  try {
    const { contentId } = req.body;
    let enrollment = await Enrollment.findOne({ user: req.user.id, course: req.params.id });
    if (!enrollment) return res.status(404).json({ msg: 'Not enrolled' });

    if (!enrollment.completedContents.includes(contentId)) {
      enrollment.completedContents.push(contentId);
    }

    const course = await Course.findById(req.params.id);
    let totalContents = 0;
    course.modules.forEach((m) => {
      totalContents += m.contents.length;
    });

    enrollment.progressPercent =
      totalContents > 0
        ? Math.round((enrollment.completedContents.length / totalContents) * 100)
        : 0;

    if (enrollment.progressPercent >= 100) {
      enrollment.status = 'completed';
      enrollment.completedAt = new Date();
    } else {
      enrollment.status = 'in_progress';
    }

    await enrollment.save();
    res.json(enrollment);
  } catch (err) {
    legacyLogger.error('request_failed', err);
    res.status(500).send('Server Error');
  }
});

module.exports = router;
