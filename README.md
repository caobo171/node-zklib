# node-zklib

- install 

```
 npm install --save node-zklib
or yarn add node-zklib
```

```javascript

const ZKLib = require('./zklib.js')
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


    // YOu can also read realtime log by getRealTimelogs function

    await zkInstance.getRealTimeLogs((data)=>{
        // do something when some checkin 
        console.log(data)
    })


    console.log('check attendances',attendances )

    console.log('check users', users)

    // Using it when you don't want to connect to biometrix device anymore
    // await zkInstance.disconnect()

}

test()

 
```