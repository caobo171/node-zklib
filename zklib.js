const ZKLibTCP = require('./zklibtcp')
const ZKLibUDP = require('./zklibudp')

const { ZKError , ERROR_TYPES } = require('./zkerror')

class ZKLib {
    constructor(ip, port, timeout, inport, protocol = 'auto') {
        this.connectionType = null
        this.preferredProtocol = protocol.toLowerCase()

        this.zklibTcp = new ZKLibTCP(ip,port,timeout) 
        this.zklibUdp = new ZKLibUDP(ip,port,timeout,inport) 
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

    setProtocol(protocol) {
        if (['tcp', 'udp', 'auto'].includes(protocol.toLowerCase())) {
            this.preferredProtocol = protocol.toLowerCase()
            return true
        }
        return false
    }

    async createSocket(cbErr, cbClose) {
        if (this.preferredProtocol === 'tcp' || this.preferredProtocol === 'auto') {
            try {
                if (!this.zklibTcp.socket) {
                    await this.zklibTcp.createSocket(cbErr, cbClose)
                    await this.zklibTcp.connect()
                }
                this.connectionType = 'tcp'
                console.log('Connected via TCP')
                return
            } catch (err) {
                if (this.preferredProtocol === 'tcp') {
                    throw new ZKError(err, 'TCP CONNECT', this.ip)
                }
                // If auto, continue to try UDP
            }
        }

        if (this.preferredProtocol === 'udp' || this.preferredProtocol === 'auto') {
            try {
                if (!this.zklibUdp.socket) {
                    await this.zklibUdp.createSocket(cbErr, cbClose)
                    await this.zklibUdp.connect()
                }
                this.connectionType = 'udp'
                console.log('Connected via UDP')
            } catch (err) {
                throw new ZKError(err, 'UDP CONNECT', this.ip)
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
    
	async getTime() {
		return await this.functionWrapper(
			() => this.zklibTcp.getTime(),
			() => this.zklibUdp.getTime()
		);
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
