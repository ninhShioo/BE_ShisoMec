const normalizeText = (value = '') =>
    String(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

const serviceImageRules = [
    {
        image: '/defaults/services/implant.svg',
        keywords: ['implant', 'cay ghep', 'trong rang']
    },
    {
        image: '/defaults/services/orthodontics.svg',
        keywords: ['nieng rang', 'chinh nha', 'khop can']
    },
    {
        image: '/defaults/services/whitening.svg',
        keywords: ['tay trang', 'lam trang']
    },
    {
        image: '/defaults/services/cosmetic.svg',
        keywords: ['rang su', 'tham my', 'tram rang', 'dan su']
    },
    {
        image: '/defaults/services/cleaning.svg',
        keywords: ['cao voi', 'lay cao', 've sinh', 'mang bam']
    },
    {
        image: '/defaults/services/consultation.svg',
        keywords: ['kham', 'tu van', 'tong quat']
    }
];

const defaultServiceImage = '/defaults/services/consultation.svg';
const doctorAvatars = [
    '/defaults/doctors/doctor-1.svg',
    '/defaults/doctors/doctor-2.svg',
    '/defaults/doctors/doctor-3.svg'
];

const getDefaultServiceImage = (service = {}) => {
    const source = normalizeText(`${service.name || ''} ${service.categoryName || ''} ${service.description || ''}`);
    const match = serviceImageRules.find((rule) => rule.keywords.some((keyword) => source.includes(keyword)));
    return match?.image || defaultServiceImage;
};

const withServiceDisplayImage = (service = {}) => {
    const defaultImage = getDefaultServiceImage(service);
    return {
        ...service,
        defaultImage,
        displayImage: service.image || defaultImage
    };
};

const getDefaultDoctorAvatar = (doctor = {}) => {
    const numericId = Number(doctor.id);
    const index = Number.isInteger(numericId) && numericId > 0
        ? (numericId - 1) % doctorAvatars.length
        : normalizeText(doctor.fullName || '').length % doctorAvatars.length;

    return doctorAvatars[index];
};

const withDoctorDisplayAvatar = (doctor = {}) => {
    const defaultAvatar = getDefaultDoctorAvatar(doctor);
    return {
        ...doctor,
        defaultAvatar,
        displayAvatar: doctor.avatar || defaultAvatar
    };
};

module.exports = {
    getDefaultServiceImage,
    withServiceDisplayImage,
    getDefaultDoctorAvatar,
    withDoctorDisplayAvatar
};
