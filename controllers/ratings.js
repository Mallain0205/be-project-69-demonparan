const Rating = require('../models/Rating');
const Appointment = require('../models/Appointment'); // ใช้ Appointment แทน Booking
const Dentist = require('../models/Dentist');         // ใช้ Dentist แทน Car

// @desc    Get all ratings (optionally filtered by dentist)
// @route   GET /api/v1/dentists/:dentistId/ratings
// @route   GET /api/v1/ratings
// @access  Public
exports.getRatings = async (req, res) => {
  try {
    let query = {};

    // ถ้ามี dentistId → ดึงเฉพาะ rating ของทันตแพทย์คนนั้น
    if (req.params.dentistId) {
      query.dentist = req.params.dentistId;
    }

    const ratings = await Rating.find(query)
      .populate({
        path: 'user',
        select: 'name',
      })
      .sort({ createdAt: -1 }); // เรียงจากใหม่ไปเก่า

    res.status(200).json({
      success: true,
      count: ratings.length,
      data: ratings,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
};


// @desc    Get rating summary for ALL dentists (avg + count per dentist)
// @route   GET /api/v1/ratings/summary
// @access  Public
exports.getRatingSummary = async (req, res) => {
  try {
    const stats = await Rating.aggregate([
      {
        $group: {
          _id: '$dentist',
          avgRating: { $avg: '$rating' },
          count: { $sum: 1 },
        },
      },
    ]);

    // แปลงเป็น { dentistId: { avg, count } }
    const summary = {};
    stats.forEach((s) => {
      summary[s._id.toString()] = {
        avg: Math.round(s.avgRating * 10) / 10,
        count: s.count,
      };
    });

    res.status(200).json({ success: true, data: summary });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
};

// @desc    Add a rating for a dentist
// @route   POST /api/v1/dentists/:dentistId/ratings
// @access  Private (ต้อง login)
exports.addRating = async (req, res) => {
  try {
    // ผูก dentist และ user จาก params และ auth middleware
    req.body.dentist = req.params.dentistId;
    req.body.user = req.user.id;

    //ตรวจสอบว่า user เคยนัดหมายกับทันตแพทย์คนนี้ไหม
    const appointment = await Appointment.findOne({
      dentist: req.params.dentistId,
      user: req.user.id,
    });

    if (!appointment) {
      return res.status(400).json({
        success: false,
        message: 'You must have an appointment with this dentist before giving a rating',
      });
    }

    //กันให้ 1 คน รีวิวทันตแพทย์ได้ครั้งเดียว
    const alreadyRated = await Rating.findOne({
      dentist: req.params.dentistId,
      user: req.user.id,
    });

    if (alreadyRated) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this dentist',
      });
    }

    const rating = await Rating.create(req.body);

    //อัปเดตค่าเฉลี่ยใน Dentist document
    await updateAverageRating(rating.dentist);

    res.status(201).json({
      success: true,
      data: rating,
    });
  } catch (err) {
    // Handle duplicate key error (unique index)
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'You have already rated this dentist',
      });
    }
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
};

// @desc    Update a rating
// @route   PUT /api/v1/ratings/:id
// @access  Private (เจ้าของ rating หรือ admin เท่านั้น)
exports.updateRating = async (req, res) => {
  try {
    let rating = await Rating.findById(req.params.id);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found',
      });
    }

    //เช็คเจ้าของหรือ admin
    if (rating.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to update this rating',
      });
    }

    // อนุญาตให้แก้ได้แค่ rating และ comment
    const allowedUpdates = { rating: req.body.rating, comment: req.body.comment };

    rating = await Rating.findByIdAndUpdate(req.params.id, allowedUpdates, {
      new: true,
      runValidators: true,
    });

    // อัปเดตค่าเฉลี่ยใหม่
    await updateAverageRating(rating.dentist);

    res.status(200).json({
      success: true,
      data: rating,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
};

// @desc    Delete a rating
// @route   DELETE /api/v1/ratings/:id
// @access  Private (เจ้าของ rating หรือ admin เท่านั้น)
exports.deleteRating = async (req, res) => {
  try {
    const rating = await Rating.findById(req.params.id);

    if (!rating) {
      return res.status(404).json({
        success: false,
        message: 'Rating not found',
      });
    }

    // เช็คเจ้าของหรือ admin
    if (rating.user.toString() !== req.user.id && req.user.role !== 'admin') {
      return res.status(401).json({
        success: false,
        message: 'Not authorized to delete this rating',
      });
    }

    const dentistId = rating.dentist;
    await rating.deleteOne();

    // อัปเดตค่าเฉลี่ยใหม่
    await updateAverageRating(dentistId);

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      error: err.message,
    });
  }
};

// Helper: คำนวณค่าเฉลี่ย rating และอัปเดตใน Dentist document
const updateAverageRating = async (dentistId) => {
  const stats = await Rating.aggregate([
    { $match: { dentist: dentistId } },
    {
      $group: {
        _id: '$dentist',
        avgRating: { $avg: '$rating' },
        count: { $sum: 1 },
      },
    },
  ]);

  if (stats.length > 0) {
    await Dentist.findByIdAndUpdate(dentistId, {
      averageRating: Math.round(stats[0].avgRating * 10) / 10, // ปัดทศนิยม 1 ตำแหน่ง
      ratingCount: stats[0].count,
    });
  } else {
    await Dentist.findByIdAndUpdate(dentistId, {
      averageRating: 0,
      ratingCount: 0,
    });
  }
};
