const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { log } = require('./helpers/errorLog')

class ZKLib {
    constructor(ip, port, timeout , inport){
        this.connectionType = null

        this.zklibTcp = new ZKLibTCP(ip,port,timeout) 
        this.zklibUdp = new ZKLibUDP(ip,port,timeout , inport) 
        this.interval = null 
        this.timer = null
        this.isBusy = false
    }

    async createSocket(cbErr, cbClose){
        if(!this.connectionType){

        }
        try{
            if(!this.zklibTcp.socket){

                await this.zklibTcp.createSocket(cbErr,cbClose)
                await this.zklibTcp.connect()
            }      
            this.connectionType = 'tcp'
        }catch(err){
            console.log('check err', err)
            try{
                await this.zklibTcp.disconnect()
            }catch(err){
                log(`[32] ${err.toString()}`)
            }

            try {
                if(!this.zklibUdp.socket){
                    await this.zklibUdp.createSocket(cbErr, cbClose)
                    await this.zklibUdp.connect()
                }   
                
                this.connectionType = 'udp'
            }catch(err){

                if(err.code !== 'EADDRINUSE'){
                    this.connectionType = null
                    try{
                        await this.zklibUdp.disconnect()
                        this.zklibUdp.socket = null
                        this.zklibTcp.socket = null
                    }catch(err){
                        log(`[47] ${err.toString()}`)
                    }
                }else{
                    this.connectionType = 'udp'
                }
                
            }
        }
    }

    async getUsers(){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.getUsers()
                }else{
                    return {data: [] , err: `Socket isn't connected !`}
                }
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.getUsers()
                }else{
                    return {data: [] , err: `Socket isn't connected !`}
                }
            default:
                return {data: [] , err: `Socket isn't connected !`}
        }
    }

    async getAttendances(ip, cb){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.getAttendances(ip,cb)
                }else{
                    return {data: [] , err: `Socket isn't connected !`}
                }
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.getAttendances(ip,cb)
                }else{
                    return {data: [] , err: `Socket isn't connected !`}
                }
            default : 
                return {data: [], err: `Socket isn't connected !`}
        }
    }

    async getRealTimeLogs(cb){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.getRealTimeLogs(cb)
                }else{
                    return { err: `Socket isn't connected !`}
                }
                
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.getRealTimeLogs(cb)
                }else{
                    return { err: `Socket isn't connected !`}
                }
            default:
                return 
        }
    }

    async disconnect(){
        switch(this.connectionType){
            case 'tcp':
                return await this.zklibTcp.disconnect()
            case 'udp':
                return await this.zklibUdp.disconnect()
            default:
                return
        }
    }

    async freeData(){
        switch(this.connectionType){
            case 'tcp':
                return await this.zklibTcp.freeData()
            case 'udp':
                return await this.zklibUdp.freeData()
            default:
                return
        }
    }


    async disableDevice(){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.disableDevice()
                }else{
                    return { err: `Socket isn't connected !`}
                }
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.disableDevice()
                }else{
                    return { err: `Socket isn't connected !`}
                }
            default:
                return
        }
    }


    async enableDevice(){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.enableDevice()
                }else{
                    return { err: `Socket isn't connected !`}
                }  
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.enableDevice()
                }else{
                    return { err: `Socket isn't connected !`}
                }
            default:
                return
        }
    }


    async getInfo(){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.getInfo()
                }else{
                    return { err: `Socket isn't connected !`}
                }  
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.getInfo()
                }else{
                    return { err: `Socket isn't connected !`}
                }
            default:
                return
        }
    }


    async getSocketStatus(){
        switch(this.connectionType){
            case 'tcp':
                if(this.zklibTcp.socket){
                    return await this.zklibTcp.getSocketStatus()
                }else{
                    return { err: `Socket isn't connected !`}
                }  
            case 'udp':
                if(this.zklibUdp.socket){
                    return await this.zklibUdp.getSocketStatus()
                }else{
                    return { err: `Socket isn't connected !`}
                }
            default:
                return
        }
    }

    setIntervalSchedule(cb , timer){
        this.interval = setInterval(cb, timer)
    }


    setTimerSchedule(cb, timer){
        this.timer = setTimeout(cb,timer)
    }

    

}


module.exports = ZKLib