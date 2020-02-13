const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError , ERROR_TYPES } = require('./zkerror')

class ZKLib {
    constructor(ip, port, timeout , inport){
        this.connectionType = null

        this.zklibTcp = new ZKLibTCP(ip,port,timeout) 
        this.zklibUdp = new ZKLibUDP(ip,port,timeout , inport) 
        this.interval = null 
        this.timer = null
        this.isBusy = false
        this.ip = ip
    }

    async functionWrapper (tcpCallback, udpCallback , command ){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    try{
                        const res =  await tcpCallback()
                        return res
                    }catch(err){
                        return Promise.reject(new ZKError(
                            err,
                            `[TCP] ${command}`,
                            this.ip
                        ))
                    }
                       
                }else{
                    return Promise.reject(new ZKError(
                        new Error( `Socket isn't connected !`),
                        `[TCP]`,
                        this.ip
                    ))
                }
            case 'udp':
                if(this.zklibUdp.socket){
                    try{
                        const res =  await udpCallback()
                        return res
                    }catch(err){
                        return Promise.reject(new ZKError(
                            err,
                            `[UDP] ${command}`,
                            this.ip
                        ))
                    }    
                }else{
                    return Promise.reject(new ZKError(
                        new Error( `Socket isn't connected !`),
                        `[UDP]`,
                        this.ip
                    ))
                }
            default:
                return Promise.reject(new ZKError(
                    new Error( `Socket isn't connected !`),
                    '',
                    this.ip
                ))
        }
    }

    async createSocket(cbErr, cbClose){
        try{
            if(!this.zklibTcp.socket){
                try{
                    await this.zklibTcp.createSocket(cbErr,cbClose)
                   

                }catch(err){
                    throw err;
                }
              
                try{
                    await this.zklibTcp.connect();
                    console.log('ok tcp')
                }catch(err){
                    throw err;
                }
            }      

            this.connectionType = 'tcp'

        }catch(err){
            try{
                await this.zklibTcp.disconnect()
            }catch(err){}

            if(err.code !== ERROR_TYPES.ECONNREFUSED){
                return Promise.reject(new ZKError(err, 'TCP CONNECT' , this.ip))
            }

            try {
                if(!this.zklibUdp.socket){
                    await this.zklibUdp.createSocket(cbErr, cbClose)
                    await this.zklibUdp.connect()
                }   
                
                console.log('ok udp')
                this.connectionType = 'udp'
            }catch(err){



                if(err.code !== 'EADDRINUSE'){
                    this.connectionType = null
                    try{
                        await this.zklibUdp.disconnect()
                        this.zklibUdp.socket = null
                        this.zklibTcp.socket = null
                    }catch(err){}


                    return Promise.reject(new ZKError(err, 'UDP CONNECT' , this.ip))
                }else{
                    this.connectionType = 'udp'
                    
                }
                
            }
        }
    }

    async getUsers(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getUsers(),
            ()=> this.zklibUdp.getUsers()
        )
    }

    async getAttendances(cb){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getAttendances(cb),
            ()=> this.zklibUdp.getAttendances(cb),
        )
    }

    async getRealTimeLogs(cb){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getRealTimeLogs(cb),
            ()=> this.zklibUdp.getRealTimeLogs(cb)
        )
    }

    async disconnect(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.disconnect(),
            ()=> this.zklibUdp.disconnect()
        )
    }

    async freeData(){
        return await this. functionWrapper(
            ()=> this.zklibTcp.freeData(),
            ()=> this.zklibUdp.freeData()
        )
    }


    async disableDevice(){
        return await this. functionWrapper(
            ()=>this.zklibTcp.disableDevice(),
            ()=>this.zklibUdp.disableDevice()
        )
    }


    async enableDevice(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.enableDevice(),
            ()=> this.zklibUdp.enableDevice()
        )
    }


    async getInfo(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.getInfo(),
            ()=>this.zklibUdp.getInfo()
        )
    }


    async getSocketStatus(){
        return await this.functionWrapper(
            ()=>this.zklibTcp.getSocketStatus(),
            ()=> this.zklibUdp.getSocketStatus()
        )
    }

    async clearAttendanceLog(){
        return await this.functionWrapper(
            ()=> this.zklibTcp.clearAttendanceLog(),
            ()=> this.zklibUdp.clearAttendanceLog()
        )
    }

    async executeCmd(command, data=''){
        return await this.functionWrapper(
            ()=> this.zklibTcp.executeCmd(command, data),
            ()=> this.zklibUdp.executeCmd(command , data)
        )
    }

    setIntervalSchedule(cb , timer){
        this.interval = setInterval(cb, timer)
    }


    setTimerSchedule(cb, timer){
        this.timer = setTimeout(cb,timer)
    }

    

}


module.exports = ZKLib