/**
 *
 * @param {number} time
 */
exports.decode = time => {
	const second = time % 60;
	time = (time - second) / 60;

	const minute = time % 60;
	time = (time - minute) / 60;

	const hour = time % 24;
	time = (time - hour) / 24;

	const day = (time % 31) + 1;
	time = (time - (day - 1)) / 31;

	const month = time % 12;
	time = (time - month) / 12;

	const year = time + 2000;

	return new Date(year, month, day, hour, minute, second);
};

/**
 *
 * @param {Date} date
 */
exports.encode = date => {
	return (
		((date.getFullYear() % 100) * 12 * 31 +
			date.getMonth() * 31 +
			date.getDate() -
			1) *
			(24 * 60 * 60) +
		(date.getHours() * 60 + date.getMinutes()) * 60 +
		date.getSeconds()
	);
};
