const ZKLib = require('node-zklib')
const test = async () => {


    let zkInstance = new ZKLib('172.16.0.204', 4370, 10000, 4000);
    try {
        await zkInstance.getSocketStatus()

        await zkInstance.createSocket()
    } catch (e) {
        if (e.code === 'EADDRINUSE') {
            console.log('eeee', e)
        }
    }


    const users = await zkInstance.getUsers()

    const attendances = await zkInstance.getAttendances('172.16.0.204', (percent, total)=>{
        // this callbacks take params is the percent of data downloaded and total data need to download 
    })

    console.log('check attendances',attendances )

    console.log('check users', users)
    await zkInstance.disconnect()
    zkInstance.getRealTimeLogs((data)=>{
        // do something when some checkin 
        console.log(data)
    })

}

test()