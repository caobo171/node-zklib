const ZKLib = require('./zklib')
const test = async () => {


    let zkInstance = new ZKLib('10.20.0.7', 4370, 10000, 4000);
    try {
        
       
        await zkInstance.createSocket()
        console.log(await zkInstance.getInfo())
    } catch (e) {
        console.log(e)
        if (e.code === 'EADDRINUSE') {
            console.log('eeee', e)
        }
    }


    const users = await zkInstance.getUsers()
    console.log(users)

    const logs = await zkInstance.getAttendances()
    console.log(logs)

    

    // const attendances = await zkInstance.getAttendances('10.20.0.7', (percent, total)=>{
    //     // this callbacks take params is the percent of data downloaded and total data need to download 
    // })

    // console.log('check attendances',attendances )

    // console.log('check users', users)
    // await zkInstance.disconnect()
    // zkInstance.getRealTimeLogs((data)=>{
    //     // do something when some checkin 
    //     console.log(data)
    // })

}

test()