


const ERROR_TYPES = {
    ECONNRESET : 'ECONNRESET',
    ECONNREFUSED : 'ECONNREFUSED',
    EADDRINUSE: 'EADDRINUSE',
    ETIMEDOUT: 'ETIMEDOUT'
}

class ZKError {

    constructor(err , command , ip){
        this.err = err
        this.ip = ip
        this.command = command
    }


    toast(){
        if(this.err.code === ERROR_TYPES.ECONNRESET ){
            return 'Another device is connecting to the device so the connection is interrupted'
        }else if (this.err.code === ERROR_TYPES.ECONNREFUSED){
            return 'IP of the device is refused'
        }else {
            return this.err.message
        }
    }

    getError(){
        return {
            err: {
                message: this.err.message,
                code: this.err.code
            },
            ip: this.ip,
            command : this.command
        }
    }
}


module.exports = {
    ZKError,
    ERROR_TYPES
}