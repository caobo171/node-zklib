const fs = require('fs')

const parseCurrentTime = ()=>{
    const currentTime = new Date()
    return {
        year: currentTime.getFullYear(),
        month: currentTime.getMonth()+1,
        day : currentTime.getDate(),
        hour: currentTime.getHours(),
        second: currentTime.getSeconds()
    }
}


module.exports.log = (text)=>{
    const currentTime = parseCurrentTime()
    fs.appendFile(`${currentTime.day}`.padStart(2,'0')+ `${currentTime.month}`.padStart(2,'0')+`${currentTime.year}.err.log`
    ,`\n [${currentTime.hour}:${currentTime.second}] ${text}`,()=>{});
}