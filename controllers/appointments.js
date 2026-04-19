const Appointment = require('../models/Appointment');
const Dentist = require('../models/Dentist');
const moment = require('moment-timezone');

// @desc    Get all appointments
// @route   GET /api/v1/appointments
// @access  Private
exports.getAppointments = async (req, res, next) => {
  try {
    let query;

    // =========================
    // USER (ดึงเฉพาะคิวที่ตัวเองเป็นคนจอง)
    // =========================
    if (req.user.role === 'user') {
      query = Appointment.find({ user: req.user.id }).populate([
        {
          path: 'dentist',
          select: 'name experience expertise'
        },
        {
          path: 'user',
          select: 'name email phone'
        }
      ]);

      const appointments = await query;

      return res.status(200).json({
        success: true,
        count: appointments.length,
        data: appointments.map(appt => ({
          ...appt._doc,
          apptDate: moment(appt.apptDate)
            .tz("Asia/Bangkok")
            .format("YYYY-MM-DD HH:mm")
        }))
      });
    }

    // =========================
    // DENTIST (ดึงเฉพาะคิวของหมอคนนี้)
    // =========================
    if (req.user.role === 'dentist') {
      if (!req.user.dentistProfile) {
        return res.status(200).json({ success: true, count: 0, data: [] });
      }

      query = Appointment.find({ dentist: req.user.dentistProfile }).populate([
        {
          path: 'dentist',
          select: 'name experience expertise'
        },
        {
          path: 'user',
          select: 'name email phone'
        }
      ]).sort('-apptDate');

      const appointments = await query;

      return res.status(200).json({
        success: true,
        count: appointments.length,
        data: appointments.map(appt => ({
          ...appt._doc,
          apptDate: moment(appt.apptDate)
            .tz("Asia/Bangkok")
            .format("YYYY-MM-DD HH:mm")
        }))
      });
    }

    // =========================
    // ADMIN (Advanced Query)
    // =========================

    // Copy req.query
    const reqQuery = { ...req.query };

    // Fields to exclude
    const removeFields = ['select', 'sort', 'page', 'limit', 'startDate', 'endDate'];
    removeFields.forEach(param => delete reqQuery[param]);

    // Create query string
    let queryStr = JSON.stringify(reqQuery);
    queryStr = queryStr.replace(
      /\b(gt|gte|lt|lte|in)\b/g,
      match => `$${match}`
    );

    let findCondition = JSON.parse(queryStr);

    // DATE = exact day search
    if (req.query.apptDate) {
      const start = new Date(req.query.apptDate);
      const end = new Date(start);

      end.setDate(end.getDate() + 1);

      findCondition.apptDate = {
        $gte: start,
        $lt: end
      };
    }

    // =========================
    // DATE RANGE BOOKING
    // =========================
    if (req.query.startDate || req.query.endDate) {
      findCondition.apptDate = {};

      if (req.query.startDate) {
        findCondition.apptDate.$gte = new Date(req.query.startDate);
      }

      if (req.query.endDate) {
        findCondition.apptDate.$lte = new Date(req.query.endDate);
      }
    }


    // Nested route: dentist appointments
    if (req.params.dentistId) {
      findCondition.dentist = req.params.dentistId;
    }

    query = Appointment.find(findCondition).populate([
      {
        path: 'dentist',
        select: 'name experience expertise'
      },
      {
        path: 'user',
        select: 'name email phone'
      }
    ]);

    // Select fields
    if (req.query.select) {
      const fields = req.query.select.split(',').join(' ');
      query = query.select(fields);
    }

    // Sort
    if (req.query.sort) {
      const sortBy = req.query.sort.split(',').join(' ');
      query = query.sort(sortBy);
    } else {
      query = query.sort('-apptDate');
    }

    // Pagination
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 25;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    const total = await Appointment.countDocuments(findCondition);

    query = query.skip(startIndex).limit(limit);

    const appointments = await query;

    // Pagination result
    const pagination = {};
    if (endIndex < total) {
      pagination.next = { page: page + 1, limit };
    }
    if (startIndex > 0) {
      pagination.prev = { page: page - 1, limit };
    }

    res.status(200).json({
      success: true,
      count: appointments.length,
      pagination,
      data: appointments.map(appt => ({
        ...appt._doc,
        apptDate: moment(appt.apptDate)
          .tz("Asia/Bangkok")
          .format("YYYY-MM-DD HH:mm")
      }))
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: 'Cannot find Appointment'
    });
  }
};


// @desc    Get single appointment
// @route   GET /api/v1/appointments/:id
// @access  Public
exports.getAppointment = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id).populate([
      {
        path: 'dentist',
        select: 'name experience expertise'
      },
      {
        path: 'user',
        select: 'name email phone'
      }
    ]);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: `No appointment with id ${req.params.id}`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...appointment._doc,
        apptDate: moment(appointment.apptDate)
          .tz("Asia/Bangkok")
          .format("YYYY-MM-DD HH:mm")
      }
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: 'Cannot find Appointment'
    });
  }
};

// @desc    Add appointment
// @route   POST /api/v1/hospitals/:hospitalId/appointments
// @access  Private
exports.addAppointment = async (req, res, next) => {
  try {
    req.body.dentist = req.params.dentistId;
    req.body.user = req.user.id;

    const dentist = await Dentist.findById(req.params.dentistId);


    if (!dentist) {
      return res.status(404).json({
        success: false,
        message: `No dentist with id ${req.params.dentistId}`
      });
    }

    //  เช็คเวลาทำงานของหมอ
    //  doc sleep
    const apptDate = new Date(req.body.apptDate);
    const hour = moment(apptDate).tz("Asia/Bangkok").hour();

    //  1. กันนอกเวลาทำงาน
    if (
      hour < dentist.workingHours.start ||
      hour >= dentist.workingHours.end
    ) {
      return res.status(400).json({
        success: false,
        message: 'Cannot book, Dentist is unavailable at this time'
      });
    }

    //  2. Block ±1 ชั่วโมง (ชั่วโมงก่อนหน้า, ชั่วโมงเดียวกัน, ชั่วโมงถัดไป)
    const windowStart = new Date(apptDate.getTime() - 60 * 60 * 1000);
    const windowEnd = new Date(apptDate.getTime() + 60 * 60 * 1000);

    const existedAppointment = await Appointment.findOne({
      dentist: req.params.dentistId,
      apptDate: {
        $gt: windowStart,
        $lt: windowEnd
      }
    });

    if (existedAppointment) {
      return res.status(400).json({
        success: false,
        message: 'This hour is already booked'
      });
    }

    //user จองได้ครั้งเดียว
    // ถ้าไม่ใช่ admin → ตรวจว่ามีนัดแล้วหรือยัง
    if (req.user.role !== 'admin') {
      const existed = await Appointment.findOne({ user: req.user.id });

      if (existed) {
        return res.status(400).json({
          success: false,
          message: 'User can create only one appointment'
        });
      }
    }

    const appointment = await Appointment.create(req.body);

    res.status(201).json({
      success: true,
      data: {
        ...appointment._doc,
        apptDate: moment(appointment.apptDate)
          .tz("Asia/Bangkok")
          .format("YYYY-MM-DD HH:mm")
      }
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: 'Cannot create Appointment'
    });
  }
};

//@desc    Update appointment
//@route   PUT /api/v1/appointments/:id
//@access  Private
exports.updateAppointment = async (req, res, next) => {
  try {
    let appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: `No appointment with id ${req.params.id}`
      });
    }
    //doc sleeping
    // ถ้ามีการแก้ apptDate
    if (req.body.apptDate) {

      const apptDate = new Date(req.body.apptDate);
      const hour = moment(apptDate).tz("Asia/Bangkok").hour();

      const targetDentistId = req.body.dentist ? req.body.dentist : appointment.dentist;
      const dentist = await Dentist.findById(targetDentistId);

      //  กันนอกเวลางาน
      if (
        hour < dentist.workingHours.start ||
        hour >= dentist.workingHours.end
      ) {
        return res.status(400).json({
          success: false,
          message: 'Cannot update, Dentist is not working at this time'
        });
      }

      //  block ±1 ชั่วโมง (ยกเว้นตัวเอง)
      const windowStart = new Date(apptDate.getTime() - 60 * 60 * 1000);
      const windowEnd = new Date(apptDate.getTime() + 60 * 60 * 1000);

      const existedAppointment = await Appointment.findOne({
        dentist: targetDentistId,
        _id: { $ne: appointment._id }, // เอาเวลาเก่าออก
        apptDate: {
          $gt: windowStart,
          $lt: windowEnd
        }
      });

      if (existedAppointment) {
        return res.status(400).json({
          success: false,
          message: 'This hour is already booked'
        });
      }
    }

    if (
      appointment.user.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(401).json({
        success: false,
        message: `User ${req.user.id} is not authorized to update this appointment`
      });
    }

    appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      req.body,
      { returnDocument: 'after', runValidators: true }
    );

    res.status(200).json({
      success: true,
      data: {
        ...appointment._doc,
        apptDate: moment(appointment.apptDate)
          .tz("Asia/Bangkok")
          .format("YYYY-MM-DD HH:mm")
      }
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Cannot update Appointment"
    });
  }
};

//@desc    Delete appointment
//@route   DELETE /api/v1/appointments/:id
//@access  Private
exports.deleteAppointment = async (req, res, next) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: `No appointment with id ${req.params.id}`
      });
    }

    if (
      appointment.user.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(401).json({
        success: false,
        message: `User ${req.user.id} is not authorized to delete this appointment`
      });
    }

    await appointment.deleteOne();

    res.status(200).json({
      success: true,
      data: {}
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: "Cannot delete Appointment"
    });
  }
};